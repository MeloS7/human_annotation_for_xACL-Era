#!/usr/bin/env python3
"""Verify anonymous-profile races against disposable PostgreSQL only."""
import concurrent.futures
import json
import os
import threading
import uuid
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

if os.environ.get('XACL_DISPOSABLE_DATABASE') != '1':
    raise SystemExit('Set XACL_DISPOSABLE_DATABASE=1 only for an isolated test database')
dsn = os.environ.get('QA_DATABASE_URL', '')
if not dsn:
    raise SystemExit('QA_DATABASE_URL is required')
config = json.loads((Path(__file__).resolve().parents[1] / 'site/config.json').read_text())
annotator = 'QA_RACE_' + uuid.uuid4().hex[:12]
code = 'c' * 64  # Nonsecret software fixture, never a production recovery code.
uid_a, uid_b = str(uuid.uuid4()), str(uuid.uuid4())

def connect(user_id):
    conn=psycopg.connect(dsn,autocommit=True)
    conn.execute('SET ROLE authenticated')
    conn.execute("SELECT set_config('request.jwt.claims',%s,false)",(json.dumps({'sub':user_id,'role':'authenticated','is_anonymous':True}),))
    return conn

with connect(uid_a) as conn:
    result=conn.execute('SELECT public.xacl_register_annotator(%s,%s)',(annotator,code)).fetchone()[0]
    assert 'record' in result,result
    record=result['record']
with connect(uid_b) as conn:
    assert 'record' in conn.execute('SELECT public.xacl_resume_annotator(%s,%s)',(annotator,code)).fetchone()[0]
barrier = threading.Barrier(2)
def save(user_id):
    with connect(user_id) as conn:
        barrier.wait(timeout=10)
        return conn.execute('SELECT public.xacl_save_annotations(%s,%s,%s,%s,%s)', (annotator,Jsonb(record),config['guidance_version'],config['guidance_sha256'],'save')).fetchone()[0]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(save,[uid_a,uid_b]))
assert sum('record' in r and r['record']['revision']==1 for r in results) == 1, results
assert sum(r.get('error')=='revision_conflict' and r['current_revision']==1 for r in results) == 1, results
with psycopg.connect(dsn,autocommit=True) as conn:
    count=conn.execute('SELECT count(*) FROM xacl_private.annotation_history WHERE annotator_id=%s',(annotator,)).fetchone()[0]
assert count==1,count
print('PASS: concurrent first saves from two anonymous device identities create one revision and one conflict.')

# One anonymous identity cannot race into two distinct annotation profiles.
uid_c=str(uuid.uuid4());barrier=threading.Barrier(2)
def register(index):
    with connect(uid_c) as conn:
        barrier.wait(timeout=10)
        return conn.execute('SELECT public.xacl_register_annotator(%s,%s)',(annotator+'_REG'+str(index),'d'*64)).fetchone()[0]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(register,[0,1]))
assert sum('record' in r for r in results)==1,results
assert sum(r.get('error')=='profile_exists' for r in results)==1,results
print('PASS: concurrent registration under one anonymous UID creates exactly one profile.')
