"""Read-only latency profile against running yabai, with off-screen native panels.
Build bin/yabai-prefix and bin/yabai-prefix-client first. Output contains timings
and Space indices only. Run: python3 tests/profile-prefix.py
"""
import os,socket,struct,json,time,subprocess,statistics,math,uuid,concurrent.futures
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def stats(a):
 a=sorted(a);return dict(n=len(a),p50=round(statistics.median(a),3),p95=round(a[math.ceil(len(a)*.95)-1],3),max=round(max(a),3))
def query(args):
 data=b'\0'.join(x.encode() for x in args)+b'\0\0'
 with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
  s.settimeout(2);s.connect('/tmp/yabai_'+os.environ['USER']+'.socket');s.sendall(struct.pack('i',len(data))+data);s.shutdown(socket.SHUT_WR)
  chunks=[]
  while True:
   b=s.recv(65536)
   if not b: break
   chunks.append(b)
  return json.loads(b''.join(chunks))
# Synthetic off-screen fixture: no window titles are recorded.
payload={'text':'YABAI ratpoison | latency fixture\nr/f/b layouts\n'+('0 Terminal    1 Browser\n'*12),
         'screen':{'x':-20000,'y':-20000,'width':1728,'height':1080},
         'badges':[{'key':str(i),'display':1+i//4,'state':'focused' if i==0 else 'front',
                    'rect':{'x':(i//2)*400,'y':0,'w':400,'h':800}} for i in range(8)]}
for b in payload['badges']: b['rect'].update(x=b['rect']['x']-20000,y=b['rect']['y']-20000)
token=str(uuid.uuid4());proc=subprocess.Popen([str(root/'bin/yabai-prefix'),'--serve',token]);revision=0
report={}
def request(action,p=None):
 global revision
 revision+=1;msg=dict(action=action,revision=revision)
 if p is not None: msg['payload']=p
 t=time.perf_counter();r=subprocess.run([str(root/'bin/yabai-prefix-client'),token,json.dumps(msg)],capture_output=True,text=True,check=True,timeout=3)
 return (time.perf_counter()-t)*1000,json.loads(r.stdout)
try:
 report['cold_prepare_ms']=round(request('prepare',payload)[0],3)
 samples=[];changes=[];render=[]
 for i in range(100):
  samples.append(request('show',payload)[0]);request('hide')
 report['warm_show_including_client']=stats(samples)
 for i in range(100):
  payload['text']=payload['text'].split('\nrefresh ')[0]+'\nrefresh '+str(i)
  elapsed,r=request('update',payload);changes.append(elapsed);render.append(r['render_ms'])
 report['changed_update_including_client']=stats(changes);report['changed_render']=stats(render)
 request('hide')
 before=subprocess.check_output(['ps','-p',str(proc.pid),'-o','time=,rss='],text=True).strip();time.sleep(2)
 after=subprocess.check_output(['ps','-p',str(proc.pid),'-o','time=,rss='],text=True).strip()
 report['idle_2s_cpu_time_and_rss_kb']=[before,after]
finally: proc.terminate();proc.wait(timeout=3)
sp='id,uuid,index,display,type,has-focus,is-visible,frames';wp='id,pid,app,title,frame,has-focus,is-minimized,is-hidden'
spaces=query(['query','--spaces']);visible=[s for s in spaces if s['is-visible']]
report['visible_spaces']=[s['index'] for s in visible]
for label,args in [('spaces_full',['query','--spaces']),('spaces_slim',['query','--spaces',sp]),('all_windows_full',['query','--windows'])]+[('visible_windows_'+str(s['index']),['query','--windows',wp,'--space',str(s['index'])]) for s in visible]:
 direct=[];cli=[]
 for i in range(25):
  t=time.perf_counter();query(args);direct.append((time.perf_counter()-t)*1000)
  t=time.perf_counter();subprocess.check_output(['/opt/homebrew/bin/yabai','-m',*args]);cli.append((time.perf_counter()-t)*1000)
 report[label]={'socket_round_trip':stats(direct),'cli_round_trip':stats(cli)}
print(json.dumps(report,indent=2))
