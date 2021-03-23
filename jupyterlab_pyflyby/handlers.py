from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado
import json
from notebook.base.handlers import IPythonHandler
import os
import subprocess


class PyflybyStatus(IPythonHandler):
    """
    Checks if pyflyby is loaded by default in ipython session
    Return {"status": "loaded"} if included by default, else {"status": "not-loaded"}
    """

    def get(self):
        from IPython.terminal.ipapp import load_default_config

        extensions = load_default_config().InteractiveShellApp.extensions.to_dict()
        if any(["pyflyby" in val for val in extensions.values()]):
            self.finish({"status": "loaded"})
        else:
            self.finish({"status": "not-loaded"})


class InstallPyflyby(IPythonHandler):
    """
    Adds pyflyby to ipython extensions, to be included default everytime ipython is launched
    """

    def post(self):
        try:
            subprocess.run(["py", "pyflyby.install_in_ipython_config_file"])
            self.finish({"result": "Installed pyflyby successfully"})
        except Exception as err:
            self.send_error({"result": "Pyflyby installation failed - {}".format(err)})


class DisablePyflybyClient(IPythonHandler):
    """
    Disables jupyterlab-pyflyby labextension for user
    """

    def post(self):
        try:
            settings_dir = os.environ.get(
                "JUPYTERLAB_SETTINGS_DIR",
                os.path.join(os.environ.get("HOME"), ".jupyter/lab/user-settings"),
            )
            pyflyby_settings_file = os.path.join(
                settings_dir, "@deshaw/jupyterlab-pyflyby/plugin.jupyterlab-settings"
            )
            installDialogDisplayed = (
                True
                if self.get_body_argument("installDialogDisplayed") == "true"
                else False
            )

            settings = {"enabled": False}
            # To remember dialog box to install pyflyby ipython extension was displayed for current user
            settings["installDialogDisplayed"] = installDialogDisplayed

            if os.path.exists(pyflyby_settings_file):
                with open(pyflyby_settings_file, "r") as f:
                    settings = {**json.load(f), **settings}

            with open(pyflyby_settings_file, "w") as f:
                json.dump(settings, f, indent=4)
            self.finish({"result": "Disabled pyflyby extension successfully"})
        except Exception as err:
            self.send_error(
                {"result": "Could not disable pyflyby extension - {}".format(err)}
            )


def setup_handlers(web_app):
    host_pattern = ".*$"

    pyflyby_handlers = [
        ("/pyflyby/pyflyby-status", PyflybyStatus),
        ("/pyflyby/install-pyflyby", InstallPyflyby),
        ("/pyflyby/disable-pyflyby", DisablePyflybyClient),
    ]
    base_url = web_app.settings["base_url"]
    pyflyby_handlers = [(url_path_join(base_url, v[0]), v[1]) for v in pyflyby_handlers]

    web_app.add_handlers(host_pattern, pyflyby_handlers)
