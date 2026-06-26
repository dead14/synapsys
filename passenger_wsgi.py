import sys, os
sys.path.insert(0, os.path.dirname(__file__) + '/backend')

from main import app
from a2wsgi import ASGIMiddleware

application = ASGIMiddleware(app)

