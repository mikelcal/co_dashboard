# Gunicorn configuration for the CO Dashboard.
#
# The dataset is static and loaded once at import time (w209.py), so
# preload_app lets the master load it a single time and the workers share
# that copy via copy-on-write — without this, each worker carries its own
# full copy of the DataFrame, which OOMs small (2GB) droplets.
#
# bind must match the nginx upstream (127.0.0.1:5000). Loopback only — nginx
# is the public-facing reverse proxy.
bind = "127.0.0.1:5000"
workers = 2
preload_app = True
