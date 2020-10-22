from __future__ import print_function
from setuptools import setup, find_packages
from subprocess import CalledProcessError
import os
from jupyter_packaging import create_cmdclass, get_version, install_npm
from pathlib import Path

name = "jupyterlab_pyflyby"

HERE = os.path.abspath(os.path.dirname(__file__))

LONG_DESCRIPTION = "A labextension to integrate pyflyby with notebooks"

version = get_version(os.path.join(name, "_version.py"))

data_files_spec = [
    ('share/jupyter/lab/extensions', Path(HERE) / 'labextension', '*.tgz'),
    (
        "etc/jupyter/jupyter_notebook_config.d",
        "jupyter-config",
        "server-extension.json",
    )
]

cmdclass = create_cmdclass('pack_labext', data_files_spec=data_files_spec)
cmdclass['pack_labext'] = install_npm(Path(HERE) / 'ts', build_cmd="build:labextension", npm=["yarn"])


setup_args = {
    'name': 'jupyterlab_pyflyby',
    'version': version,
    'description': 'Pyflyby jupyterlab extension',
    'long_description': LONG_DESCRIPTION,
    'License': 'BSD-3-Clause',
    'include_package_data': True,
    'install_requires': [
        'pyflyby'
    ],
    'packages': find_packages(),
    'zip_safe': False,
    'cmdclass': cmdclass,
    'url': 'https://github.com/deshaw/jupyterlab-pyflyby',
    'keywords': [
        'ipython',
        'jupyter',
        'pyflyby'
    ],
    'classifiers': [
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.3',
        'Programming Language :: Python :: 3.4',
        'Programming Language :: Python :: 3.5',
        'Programming Language :: Python :: 3.7',
        'Programming Language :: Python :: 3.8',
        'Framework :: Jupyter',
    ],
}

setup(**setup_args)