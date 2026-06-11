import os

from w209 import app

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")