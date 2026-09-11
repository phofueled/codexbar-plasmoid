import datetime, fcntl, json, math, os, pathlib, urllib.request
cache = pathlib.Path.home() / '.cache/codexbar-cad-rate.json'
cache.parent.mkdir(parents=True, exist_ok=True)
with open(str(cache) + '.lock', 'w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        data = json.loads(cache.read_text())
        assert math.isfinite(float(data['rate'])) and float(data['rate']) > 0
    except Exception:
        data = {'rate': 1.3822, 'date': '2026-09-10'}
    today = datetime.date.today().isoformat()
    def on_ac():
        supplies = pathlib.Path('/sys/class/power_supply')
        for supply in supplies.iterdir():
            try:
                if (supply / 'type').read_text().strip() != 'Battery' and (supply / 'online').read_text().strip() == '1':
                    return True
            except OSError:
                pass
        return False
    if data.get('checked') != today and on_ac():
        try:
            with urllib.request.urlopen('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1', timeout=20) as response:
                observation = json.load(response)['observations'][-1]
            rate = float(observation['FXUSDCAD']['v'])
            if not math.isfinite(rate) or rate <= 0:
                raise ValueError('Invalid rate')
            data = {'rate': rate, 'date': observation['d'], 'checked': today}
            temp = cache.with_suffix('.tmp')
            temp.write_text(json.dumps(data))
            os.replace(temp, cache)
        except Exception:
            pass
    print(json.dumps(data))
