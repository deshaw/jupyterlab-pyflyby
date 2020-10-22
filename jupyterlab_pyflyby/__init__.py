from .pyflyby_handler import PyflybyStatus, InstallPyflyby, DisablePyflybyClient
from notebook.utils import url_path_join

def load_jupyter_server_extension(nb_server_app):
    pyflyby_handlers = [
        ("/pyflyby/pyflyby-status", PyflybyStatus),
        ("/pyflyby/install-pyflyby", InstallPyflyby),
        ("/pyflyby/disable-pyflyby", DisablePyflybyClient)
    ]
    web_app = nb_server_app.web_app
    base_url = web_app.settings["base_url"]

    pyflyby_handlers = [(url_path_join(base_url, v[0]), v[1]) for v in pyflyby_handlers]

    web_app.add_handlers(".*", pyflyby_handlers)
