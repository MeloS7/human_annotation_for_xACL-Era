#!/usr/bin/env python3
"""Disposable browser QA bridge to real PostgreSQL, never a deployment server."""
import argparse
import base64
import datetime
import time
import uuid
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

import psycopg
from psycopg.types.json import Jsonb

RPC_FIELDS = {
    'xacl_quality_annotation_health': [],
    'xacl_quality_register_annotator': ['p_annotator_id', 'p_recovery_code'],
    'xacl_quality_resume_annotator': ['p_annotator_id', 'p_recovery_code'],
    'xacl_quality_current_annotations': [],
    'xacl_quality_load_annotations': ['p_annotator_id'],
    'xacl_quality_save_annotations': ['p_annotator_id', 'p_record', 'p_guidance_version', 'p_guidance_sha256', 'p_operation'],
    'xacl_annotation_health': [],
    'xacl_register_annotator': ['p_annotator_id', 'p_recovery_code'],
    'xacl_resume_annotator': ['p_annotator_id', 'p_recovery_code'],
    'xacl_current_annotations': [],
    'xacl_load_annotations': ['p_annotator_id'],
    'xacl_save_annotations': ['p_annotator_id', 'p_record', 'p_guidance_version', 'p_guidance_sha256', 'p_operation'],
}

def b64json(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')

def qa_session(user_id=None):
    user_id = user_id or str(uuid.uuid4())
    now = int(time.time())
    claims = {'sub':user_id,'role':'authenticated','aud':'authenticated','is_anonymous':True,'iat':now,'exp':now+3600,'session_id':str(uuid.uuid4())}
    token = b64json({'alg':'HS256','typ':'JWT'})+'.'+b64json(claims)+'.'+b64json({'synthetic_qa_only':True})
    user = {'id':user_id,'aud':'authenticated','role':'authenticated','is_anonymous':True,'app_metadata':{'provider':'anonymous'},'user_metadata':{},'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    return {'access_token':token,'refresh_token':'synthetic_qa_refresh_'+user_id,'token_type':'bearer','expires_in':3600,'expires_at':now+3600,'user':user}

def qa_claims(headers):
    token = headers.get('Authorization','').removeprefix('Bearer ')
    if not token:
        return None
    parts=token.split('.')
    if len(parts)!=3 or parts[2]!=b64json({'synthetic_qa_only':True}):
        raise ValueError('Test bridge accepts only synthetic QA tokens')
    claims=json.loads(base64.urlsafe_b64decode(parts[1]+'='*(-len(parts[1])%4)))
    uuid.UUID(claims['sub'])
    return claims

PREFIX = '/human_annotation_for_xACL-Era/'
root = Path(__file__).resolve().parents[1]

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root / 'site'), **kwargs)

    def log_message(self, *_args):
        pass  # Never log RPC payloads/capabilities, even synthetic ones.

    def do_GET(self):
        if self.path == '/__auth/user':
            claims=qa_claims(self.headers)
            return self.send_json(qa_session(claims['sub'])['user'] if claims else {'error':'unauthorized'},200 if claims else 401)
        path = urlsplit(self.path).path
        if not path.startswith(PREFIX):
            return self.send_error(404)
        decoded = unquote(path[len(PREFIX):])
        if any(part in ('.', '..') for part in decoded.split('/')):
            return self.send_error(400)
        self.path = '/' + decoded
        return super().do_GET()

    def send_json(self, value, status=200):
        body=json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.startswith('/__auth/'):
            length=int(self.headers.get('Content-Length',0))
            args=json.loads(self.rfile.read(length) or b'{}')
            endpoint=self.path.removeprefix('/__auth/')
            if endpoint=='signup': return self.send_json(qa_session())
            if endpoint.startswith('token?grant_type=refresh_token'):
                refresh=args.get('refresh_token','')
                if not refresh.startswith('synthetic_qa_refresh_'): return self.send_json({'error':'invalid_refresh_token'},400)
                return self.send_json(qa_session(refresh.removeprefix('synthetic_qa_refresh_')))
            if endpoint.startswith('logout'): return self.send_json({})
            return self.send_json({'error':'unknown_auth_test_endpoint'},404)
        function = self.path.removeprefix('/__rpc/')
        if not self.path.startswith('/__rpc/') or function not in RPC_FIELDS:
            return self.send_error(404)
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 <= length <= 8 * 1024 * 1024:
                return self.send_error(413)
            args = json.loads(self.rfile.read(length))
            fields = RPC_FIELDS[function]
            if set(args) != set(fields):
                raise ValueError('Unexpected test RPC arguments')
            values = [Jsonb(args[k]) if k == 'p_record' else args[k] for k in fields]
            with psycopg.connect(os.environ['QA_DATABASE_URL'], autocommit=True) as conn:
                claims=qa_claims(self.headers)
                conn.execute('SET ROLE authenticated' if claims else 'SET ROLE anon')
                if claims: conn.execute("SELECT set_config('request.jwt.claims',%s,false)",(json.dumps(claims),))
                placeholders = ','.join('%s' for _ in fields)
                result = conn.execute(f'SELECT public.{function}({placeholders})', values).fetchone()[0]
            body = json.dumps(result).encode()
            status = 200
        except psycopg.Error as exc:
            body = json.dumps({'message': exc.diag.message_primary or 'Database rejected test request'}).encode()
            status = 403 if exc.sqlstate == '42501' else 400
        except (ValueError, KeyError, TypeError):
            body = b'{"message":"Invalid synthetic test request"}'
            status = 400
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'http://127.0.0.1:{server.server_port}{PREFIX}', flush=True)
    server.serve_forever()
