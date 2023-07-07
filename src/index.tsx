/**
 * Basic workflow -
 * 1. Connects to comms created by pyflyby
 * 2. Recieves imports added by pyflyby via PYFLYBY_COMMS.MISSING_IMPORTS
 * 3. Sends import statements recived in previous step to kernel for formatting using tidy_imports
 * 4. Recieves formatted imports via PYFLYBY_COMMS.FORMAT_IMPORTS which are added at suitable location in notebook
 *
 * Selecting cell where imports are added -
 * 1. First cell with 'pyflyby-cell' tag, if not  present then next step.
 * 2. First code cell which does not contain magic command
 * 3. If selected cell doesn't contain any import statement, add a new cell above the code cell.
 *
 * Selecting insert location inside the cell -
 * 1. If PYFLYBY_END_MSG is present, import is added above it.
 * 2. Added import after last import statement in code cell. Identifying import statement is
 *    is done by simple heuristics. This step can be shifted to pyflyby where python parser can be used to
 *    determine it accurately.
 */

// Lumino imports
import { toArray, ArrayExt } from '@lumino/algorithm';
import { JSONValue, JSONObject } from '@lumino/coreutils';
import { Widget, Panel } from '@lumino/widgets';

// Jupyterlab imports
import { JupyterFrontEnd } from '@jupyterlab/application';
import { Dialog, ISessionContext, showDialog } from '@jupyterlab/apputils';
import { ICellModel } from '@jupyterlab/cells';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import {
  INotebookModel,
  INotebookTracker,
  NotebookPanel
} from '@jupyterlab/notebook';
import { LabIcon } from '@jupyterlab/ui-components';
import { ICommandPalette, ToolbarButton } from '@jupyterlab/apputils';
import { DisposableDelegate, IDisposable } from '@lumino/disposable';
import { Session, Kernel, KernelMessage } from '@jupyterlab/services';
import { Signal } from '@lumino/signaling';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import tidyImportSVG from '../style/tidy-import.svg';
import { debug } from 'debug';
import React from 'react';

// relative imports
import { findCell, findLinePos } from './cellUtils';
import {
  PYFLYBY_CELL_TAG,
  PYFLYBY_START_MSG,
  PYFLYBY_END_MSG,
  PYFLYBY_COMMS
} from './constants';
import { requestAPI } from './handler';

const log = debug('PYFLYBY:');

class CommLock {
  _releaseLock: any;
  promise: any;
  requestedLockCount: number;
  clearedLockCount: number;
  _activeTimeout: number;
  _lockTimeout: number;
  _timeoutSignal: Signal<CommLock, number>;
  _recentKernelState: string;
  _sessionContext: ISessionContext;

  constructor(_lockTimeout: number, sessionContext: ISessionContext) {
    this._lockTimeout = _lockTimeout;
    this._activeTimeout = null;
    this.requestedLockCount = 0;
    this.clearedLockCount = 0;
    this._releaseLock = {};
    this.promise = { 0: Promise.resolve() };
    this._timeoutSignal = new Signal<CommLock, number>(this);
    this._sessionContext = sessionContext;
    this._sessionContext.statusChanged.connect(this.kernelStateRecorder, this);
    this._timeoutSignal.connect(this.timeoutExpireHandler, this);
  }

  kernelStateRecorder(sender: ISessionContext, args: Kernel.Status) {
    this._recentKernelState = args;
  }

  _clearTimeout() {
    window.clearTimeout(this._activeTimeout);
    this._activeTimeout = null;
  }

  /*
    If the kernel was busy the last time, we assume it was busy executing 
    code and we restart the timeout.
  */
  timeoutExpireHandler(sender: CommLock, id: number) {
    this._clearTimeout();
    if (this._recentKernelState === 'busy') {
      console.debug('Extending Timeout For: ', id);
      this.createTimeout(id);
    } else {
      this.release(id);
    }
  }

  async acquire(): Promise<number> {
    const lastLockPromise = this.promise[this.requestedLockCount];
    this.requestedLockCount++;
    const lockId = this.requestedLockCount;
    this.promise[lockId] = new Promise(resolve => {
      this._releaseLock[lockId] = resolve;
    });
    await lastLockPromise;
    return new Promise((res, rej) => res(lockId));
  }

  release(lockId: number): void {
    this.clearedLockCount = lockId;
    this._releaseLock[lockId]?.();
    delete this._releaseLock[lockId];
    this._clearTimeout();
    if (this.clearedLockCount < this.requestedLockCount) {
      this.createTimeout(lockId + 1);
    }
  }

  createTimeout(id: number) {
    this._activeTimeout = setTimeout(() => {
      this._timeoutSignal.emit(id);
    }, this._lockTimeout);
  }
}

// We'd like to show the notification only once per session, not for each notebook
let _userWasNotified = false;

/**
 * An extension that adds pyflyby integration to a single notebook widget
 */
class PyflyByWidget extends Widget {
  _lock: CommLock;
  constructor(
    context: DocumentRegistry.IContext<INotebookModel>,
    panel: Panel,
    settingRegistry: ISettingRegistry
  ) {
    super();
    // get a reference to the settings registry
    settingRegistry.load('@deshaw/jupyterlab-pyflyby:plugin').then(
      (settings: ISettingRegistry.ISettings) => {
        this._settings = settings;
        const enabled =
          settings.get('enabled').user || settings.get('enabled').composite;
        if (enabled) {
          this._sessionContext.kernelChanged.connect(
            this._handleKernelChange,
            this
          );
          this._sessionContext.statusChanged.connect(
            this._handleKernelStatusChange,
            this
          );
        }

        const _lockTimeout =
          1000 *
          ((settings.get('lockTimeout').user ||
            settings.get('lockTimeout').composite) as number);
        this._lock = new CommLock(_lockTimeout, this._sessionContext);
      },
      (err: any) => {
        log('PYFLYBY extension has been disabled');
      }
    );
    this._context = context;
    this._sessionContext = context.sessionContext;
  }

  async _launchDialog(imports: any) {
    /**
     * Since we are making the first import, create a new dialog
     */
    const dialog = new Dialog({
      title: 'PYFLYBY',
      body: `PYFLYBY will be adding imports to the first code cell in the notebook.
            To disable the PYFLYBY extension or to disable this notification in future, go
            to Settings -> Advanced Settings Editor and choose PYFLYBY preferences tab`,
      buttons: [Dialog.okButton()]
    });
    try {
      await dialog.launch();
      return imports;
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * All the logic related to finding the right cell
   */
  _findAndSetImportCoordinates() {
    const { model } = this._context;
    let pyflybyCellIndex = ArrayExt.findFirstIndex(
      toArray(model.cells),
      (cell: ICellModel, index: number) => {
        const tags = cell.metadata.get('tags') as string[];
        return !!(tags && tags.indexOf(PYFLYBY_CELL_TAG) !== -1);
      }
    );

    /**
     * Since the cell doesn't exist, we make one or, if the first
     * code cell contains an import block, put it below that.
     */
    if (pyflybyCellIndex === -1) {
      pyflybyCellIndex = findCell(toArray(model.cells));
    }

    let cell = model.cells.get(pyflybyCellIndex);

    let position = findLinePos(model.cells.get(pyflybyCellIndex));

    if (position === -1) {
      cell = this._context.model.contentFactory.createCodeCell({
        cell: {
          source: `${PYFLYBY_START_MSG}\n\n${PYFLYBY_END_MSG}`,
          cell_type: 'code',
          metadata: {}
        }
      });

      this._context.model.cells.insert(pyflybyCellIndex, cell);
      position = PYFLYBY_START_MSG.length + 1;
    }
    cell.metadata.set('tags', [PYFLYBY_CELL_TAG]);
    return { cellIndex: pyflybyCellIndex, position };
  }

  /**
   * Adds the import block to the appropriate cell at the appropriate
   * location.
   *
   * @param importBlock - the import statement or block of import statements
   */
  _insertImport(imports: any) {
    let p: Promise<any> = null;
    if (!_userWasNotified && !this._settings.get('disableNotification').user) {
      p = this._launchDialog(imports);
      _userWasNotified = true;
    } else {
      p = Promise.resolve(imports);
    }

    // creates the cell for imports
    this._findAndSetImportCoordinates();
    return p;
  }

  _sendFormatCodeMsg(imports: any, lockId: number) {
    const pyflybyCellIndex = ArrayExt.findFirstIndex(
      toArray(this._context.model.cells),
      (cell: ICellModel, index: number) => {
        const tags = cell.metadata.get('tags') as string[];
        return !!(tags && tags.indexOf(PYFLYBY_CELL_TAG) !== -1);
      }
    );
    if (pyflybyCellIndex !== -1) {
      const cellSource = this._context.model.cells
        .get(pyflybyCellIndex)
        .toJSON().source;
      const comm = this._comms[PYFLYBY_COMMS.FORMAT_IMPORTS];
      if (comm && !comm.isDisposed) {
        comm.send({
          msg_id: lockId,
          input_code: cellSource,
          imports: imports,
          type: PYFLYBY_COMMS.FORMAT_IMPORTS
        });
      }
    }
  }

  async sendTidyImportRequest(): Promise<any> {
    const cellArray = this._getCellArray();
    const comm = this._comms[PYFLYBY_COMMS.TIDY_IMPORTS];
    if (comm && !comm.isDisposed) {
      comm.send({
        type: PYFLYBY_COMMS.TIDY_IMPORTS,
        cellArray: cellArray,
        checksum: this._getHashOfCodeInNotebook()
      });
    }
  }

  _getCellArray() {
    const cells = this._context.model.cells;
    const cellArray = [];

    for (let i = 0; i < cells.length; ++i) {
      cellArray.push({
        text: cells.get(i).value.text,
        type: cells.get(i).type
      });
    }

    return cellArray;
  }

  restoreNotebookAfterTidyImports(cellArray: any, imports: any): void {
    const { cellIndex } = this._findAndSetImportCoordinates();
    const cells = this._context.model.cells;
    for (let i = 0; i < cellArray.length; ++i) {
      const cell = cells.get(i);
      cell.value.remove(0, cell.value.text.length);
      cell.value.insert(0, cellArray[i].text.trim());
    }
    const joined_imports = imports.join('\n').trim();
    if (cells.get(0).value.text.length === 0) {
      cells.get(0).value.insert(0, joined_imports);
    } else {
      const cell = this._context.model.contentFactory.createCodeCell({
        cell: {
          source: joined_imports,
          cell_type: 'code',
          metadata: {
            trusted: true
          }
        }
      });
      cells.insert(cellIndex, cell);
    }
  }

  _fastStringHash(str: string) {
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
      const chr = str.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }

  _getHashOfCodeInNotebook() {
    const cellArray = this._getCellArray();
    let joinedText = '';
    for (let i = 0; i < cellArray.length; ++i) {
      joinedText = joinedText + cellArray[i].text;
    }
    return this._fastStringHash(joinedText);
  }

  _getCommMsgHandler() {
    return async (msg: KernelMessage.ICommMsgMsg) => {
      const msgContent: JSONValue = msg.content.data;
      switch ((msgContent as JSONObject).type) {
        case PYFLYBY_COMMS.MISSING_IMPORTS: {
          const itd = msgContent['missing_imports'];
          this._insertImport(itd).then(async imports => {
            // Acquire new lock but wait for previous lock to expire
            const currentLockId = await this._lock.acquire();
            this._sendFormatCodeMsg(imports, currentLockId);
          });
          break;
        }
        case PYFLYBY_COMMS.FORMAT_IMPORTS: {
          this._formatImports(msgContent);
          const { msg_id: lockId }: any = msgContent;
          this._lock.release(lockId);
          break;
        }
        case PYFLYBY_COMMS.INIT: {
          this._initializeComms().catch(console.error);
          break;
        }
        case PYFLYBY_COMMS.TIDY_IMPORTS: {
          const { cells, imports, checksum } = msgContent;
          if (checksum === this._getHashOfCodeInNotebook()) {
            this.restoreNotebookAfterTidyImports(cells, imports);
          } else {
            await showDialog({
              title: 'TidyImports Interrupted',
              body: 'TidyImports could not be run because code in the notebook has been changed',
              buttons: [
                Dialog.okButton({
                  label: 'Ok'
                })
              ],
              defaultButton: 0
            });
          }
          break;
        }
        default:
          break;
      }
    };
  }

  async _initializeComms() {
    if (!this._sessionContext.session) {
      return;
    }
    const { kernel } = this._sessionContext.session;
    if (!kernel) {
      return;
    }
    // Open the comm
    const targetName = PYFLYBY_COMMS.MISSING_IMPORTS;
    const comm = kernel.createComm(targetName);
    comm.onMsg = this._getCommMsgHandler();
    try {
      comm.open();
    } catch (e) {
      console.error(`Unable to open PYFLYBY comm - ${e}`);
    }

    const formatMsgComm = kernel.createComm(PYFLYBY_COMMS.FORMAT_IMPORTS);
    formatMsgComm.onMsg = this._getCommMsgHandler();
    formatMsgComm.onClose = (msg: KernelMessage.ICommCloseMsg) => {
      const commId = msg.content.comm_id;
      delete this._comms[commId];
    };
    this._comms[PYFLYBY_COMMS.FORMAT_IMPORTS] = formatMsgComm;
    try {
      formatMsgComm.open();
    } catch (e) {
      console.error(`Unable to open PYFLYBY comm - ${e}`);
    }

    const tidyImportsComm = kernel.createComm(PYFLYBY_COMMS.TIDY_IMPORTS);
    tidyImportsComm.onMsg = this._getCommMsgHandler();
    this._comms[PYFLYBY_COMMS.TIDY_IMPORTS] = tidyImportsComm;
    try {
      tidyImportsComm.open();
    } catch (e) {
      console.error(`Unable to open PYFLYBY comm - ${e}`);
    }
    kernel.registerCommTarget(
      PYFLYBY_COMMS.INIT,
      (comm, msg: KernelMessage.ICommOpenMsg) => {
        comm.onMsg = this._getCommMsgHandler();
      }
    );

    return Promise.resolve();
  }

  _formatImports(msgData: any) {
    const { formatted_code: formattedCode } = msgData;
    const pyflybyCellIndex = ArrayExt.findFirstIndex(
      toArray(this._context.model.cells),
      (cell: ICellModel, index: number) => {
        const tags = cell.metadata.get('tags') as string[];
        return !!(tags && tags.indexOf(PYFLYBY_CELL_TAG) !== -1);
      }
    );
    if (pyflybyCellIndex !== -1) {
      const cell: ICellModel = this._context.model.cells.get(pyflybyCellIndex);
      cell.value.remove(0, cell.value.text.length);
      cell.value.insert(0, formattedCode);
    }
  }

  async _handleKernelChange(
    sender: ISessionContext,
    kernelChangedArgs: Session.ISessionConnection.IKernelChangedArgs
  ): Promise<any> {
    return await this._initializeComms();
  }

  _handleKernelStatusChange(
    sender: ISessionContext,
    args: Kernel.Status
  ): Promise<any> | null {
    if (args === 'restarting') {
      return this._initializeComms();
    }
    return null;
  }

  private _context: DocumentRegistry.IContext<INotebookModel> = null;
  private _sessionContext: ISessionContext = null;
  private _settings: ISettingRegistry.ISettings = null;
  private _comms: any = {};
}

/**
 * An extension that adds pyflyby integration to a notebook widget
 */
class PyflyByWidgetExtension implements DocumentRegistry.WidgetExtension {
  constructor(settingRegistry: ISettingRegistry) {
    // get a reference to the settings registry
    // This is shared between all notebooks. I.e. not possible to
    // have different pyflyby settings for different notebooks
    this._settingRegistry = settingRegistry;
    this._loadSettings().catch(console.error);
  }

  async _loadSettings() {
    try {
      await this._settingRegistry.load('@deshaw/jupyterlab-pyflyby:plugin');
      log('Successfully loaded PYFLYBY extension settings');
    } catch (e) {
      console.error('Settings could not be loaded');
    }
  }

  createNew(panel: Panel, context: DocumentRegistry.IContext<INotebookModel>) {
    pyflybyWidget = new PyflyByWidget(context, panel, this._settingRegistry);
    return pyflybyWidget;
  }

  private _settingRegistry: ISettingRegistry = null;
}

async function isPyflybyInstalled() {
  const pyflybyStatus = await requestAPI<any>('pyflyby-status');
  return pyflybyStatus.status;
}

async function installPyflyby() {
  try {
    await requestAPI<any>('install-pyflyby', { method: 'POST' });
  } catch (err) {
    const errMsg = await err.json();
    console.error(errMsg.result);
  }
}

async function disableJupyterlabPyflyby(registry: ISettingRegistry) {
  try {
    await requestAPI<any>('disable-pyflyby', {
      method: 'POST',
      mode: 'cors',
      cache: 'no-cache',
      credentials: 'include',
      headers: { 'Content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams('installDialogDisplayed=true')
    });
  } catch (err) {
    const errMsg = await err.json();
    console.error(errMsg.result);
  }
  await registry.reload('@deshaw/jupyterlab-pyflyby:plugin');
}

const installationBody = (
  <div>
    <p>
      To use @deshaw/jupyterlab-pyflyby,{' '}
      <a
        href="https://github.com/deshaw/pyflyby/blob/master/README.rst"
        style={{ color: '#0000EE' }}
        target="_blank"
        rel="noopener noreferrer"
      >
        pyflyby
      </a>{' '}
      ipython extension needs to be installed.
    </p>
    <br />
    <p>Clicking on "Install" will run following command</p>
    <div
      style={{
        font: 'monospace',
        color: '#ffffff',
        backgroundColor: '#000000',
        marginTop: '5px'
      }}
    >
      $ py pyflyby.install_in_ipython_config_file
    </div>
    <br />
  </div>
);

class TidyImportButtonExtension
  implements DocumentRegistry.IWidgetExtension<NotebookPanel, INotebookModel>
{
  createNew(
    widget: NotebookPanel,
    context: DocumentRegistry.IContext<INotebookModel>
  ): IDisposable {
    const button = new ToolbarButton({
      className: 'tidy-import-button',
      tooltip: 'Run tidy-imports on this notebook',
      icon: TidyImportsIcon,
      onClick: () => pyflybyWidget.sendTidyImportRequest()
    });

    widget.toolbar.insertItem(10, 'tidy-imports', button);
    return new DisposableDelegate(() => {
      button.dispose();
    });
  }
}

const TidyImportsIcon = new LabIcon({
  name: 'DJSDocSearch',
  svgstr: tidyImportSVG
});

let pyflybyWidget: any = null;

const djsTidyImportsCommand = 'djs:run-tidy-imports';

const extension = {
  id: '@deshaw/jupyterlab-pyflyby:plugin',
  autoStart: true,
  requires: [ISettingRegistry, INotebookTracker, ICommandPalette],
  activate: async function (
    app: JupyterFrontEnd,
    registry: ISettingRegistry,
    tracker: INotebookTracker,
    palette: ICommandPalette
  ): Promise<void> {
    console.log(
      'JupyterLab extension @deshaw/jupyterlab-pyflyby is activated!'
    );

    app.commands.addCommand(djsTidyImportsCommand, {
      execute: () => pyflybyWidget.sendTidyImportRequest(),
      icon: TidyImportsIcon,
      label: 'Run tidy-imports on Notebook'
    });

    palette.addItem({
      command: djsTidyImportsCommand,
      category: 'Notebook'
    });

    const settings = await registry.load('@deshaw/jupyterlab-pyflyby:plugin');
    const enabled =
      settings.get('enabled').user || settings.get('enabled').composite;
    const dialogDisplayedEarlier = settings.get('installDialogDisplayed').user;

    if (enabled) {
      const response = await isPyflybyInstalled();
      if (response !== 'loaded') {
        if (dialogDisplayedEarlier) {
          // Dialog to install pyflyby ipython extensions was displayed earlier,
          // install it since user is trying to use pyflyby by manually enabling
          // jupyterlab-pyflyby
          await installPyflyby();
        } else {
          const result = await showDialog({
            title: 'Installation required',
            body: installationBody,
            buttons: [
              Dialog.okButton({
                label: 'Install'
              }),
              Dialog.cancelButton({ label: 'Cancel', displayType: 'default' })
            ],
            defaultButton: 0
          });
          result.button.accept
            ? await installPyflyby()
            : await disableJupyterlabPyflyby(registry);
        }
      }
    }

    app.docRegistry.addWidgetExtension(
      'Notebook',
      new PyflyByWidgetExtension(registry)
    );

    app.docRegistry.addWidgetExtension(
      'Notebook',
      new TidyImportButtonExtension()
    );
  }
};

export default extension;
