#!/usr/bin/env python3
"""Steuert headless Chrome per DevTools-Protokoll: Seite laden, auf Bedingung warten, Text/Screenshot holen.

python3 test/cdp.py URL --wait "JS-Ausdruck" [--eval "JS"] [--shot datei.png] [--width 1200] [--height 900] [--profile DIR]
"""
import argparse, asyncio, base64, json, subprocess, time, urllib.request, os, signal
import websockets


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('url'); ap.add_argument('--wait', default='document.readyState=="complete"')
    ap.add_argument('--eval', default=None); ap.add_argument('--shot', default=None)
    ap.add_argument('--width', type=int, default=1200); ap.add_argument('--height', type=int, default=900)
    ap.add_argument('--profile', required=True); ap.add_argument('--timeout', type=float, default=240)
    ap.add_argument('--mobile', action='store_true'); ap.add_argument('--full', action='store_true')
    a = ap.parse_args()
    port = 9333
    proc = subprocess.Popen(['google-chrome', '--headless=new', '--no-first-run', '--no-default-browser-check', f'--user-data-dir={a.profile}',
                             f'--remote-debugging-port={port}', f'--window-size={a.width},{a.height}', '--enable-unsafe-webgpu', 'about:blank'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json')); break
            except Exception:
                time.sleep(0.2)
        ws_url = [t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl']
        async with websockets.connect(ws_url, max_size=200_000_000) as ws:
            n = 0
            async def call(method, **params):
                nonlocal n; n += 1; my = n
                await ws.send(json.dumps({'id': my, 'method': method, 'params': params}))
                while True:
                    m = json.loads(await ws.recv())
                    if m.get('method') == 'Runtime.consoleAPICalled':
                        print('[console]', ' '.join(str(x.get('value', x.get('description', ''))) for x in m['params']['args'])[:400])
                    if m.get('method') == 'Runtime.exceptionThrown':
                        print('[exception]', m['params']['exceptionDetails'].get('exception', {}).get('description', '')[:600])
                    if m.get('id') == my:
                        return m.get('result', {})
            await call('Runtime.enable')
            if a.mobile:
                await call('Emulation.setDeviceMetricsOverride', width=a.width, height=a.height, deviceScaleFactor=2, mobile=True)
            await call('Page.enable')
            await call('Page.navigate', url=a.url)
            t0 = time.time()
            while time.time() - t0 < a.timeout:
                r = await call('Runtime.evaluate', expression=f'!!({a.wait})', returnByValue=True)
                if r.get('result', {}).get('value'):
                    break
                await asyncio.sleep(0.5)
            else:
                print('TIMEOUT beim Warten auf', a.wait)
            if a.eval:
                r = await call('Runtime.evaluate', expression=a.eval, returnByValue=True, awaitPromise=True)
                print(r.get('result', {}).get('value', r))
            if a.shot:
                await asyncio.sleep(0.8)
                params = {'format': 'png'}
                if a.full:
                    m = await call('Page.getLayoutMetrics')
                    h = m['cssContentSize']['height']
                    await call('Emulation.setDeviceMetricsOverride', width=a.width, height=int(h), deviceScaleFactor=2 if a.mobile else 1, mobile=a.mobile)
                    await asyncio.sleep(0.6)
                r = await call('Page.captureScreenshot', **params)
                open(a.shot, 'wb').write(base64.b64decode(r['data']))
                print('Screenshot:', a.shot)
    finally:
        proc.send_signal(signal.SIGTERM)
        try: proc.wait(5)
        except Exception: proc.kill()


asyncio.run(main())
