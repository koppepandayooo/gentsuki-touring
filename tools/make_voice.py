"""ナビの決まり文句をずんだもんの声（VOICEVOX）で音声ファイルにする。

使い方（パソコンで）:
  1. VOICEVOX（https://voicevox.hiroshiba.jp/）を入れて起動しておく
  2. python tools/make_voice.py
  3. web/voice/zundamon/ に音声ファイルと index.json ができるので、コミットして push

web/voice/phrases.json の文を読み、文が変わっていない音声ファイルは作り直さない（--all で全部作り直す）。
ffmpeg があれば小さい MP3 に、なければ WAV で保存する。アプリは index.json に載っている音声だけ使う。
ずんだもんの利用規約により、アプリに「VOICEVOX:ずんだもん」の表記が必要（設定画面に出している）。
"""
import json
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ENGINE = 'http://127.0.0.1:50021'
SPEAKER = 3          # ずんだもん（ノーマル）
SPEED = 1.1          # 少し速め（走行中に聞き取りやすく、短く）
SAMPLE_RATE = 16000  # ファイルを小さくするため

ROOT = Path(__file__).resolve().parent.parent
PHRASES = ROOT / 'web' / 'voice' / 'phrases.json'
OUT = ROOT / 'web' / 'voice' / 'zundamon'


def post(path, params, body=None):
    url = f'{ENGINE}{path}?{urllib.parse.urlencode(params)}'
    data = json.dumps(body).encode() if body is not None else b''
    req = urllib.request.Request(url, data=data, method='POST', headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    redo = '--all' in sys.argv
    phrases = json.loads(PHRASES.read_text(encoding='utf-8'))['phrases']
    OUT.mkdir(parents=True, exist_ok=True)
    index_path = OUT / 'index.json'
    old = json.loads(index_path.read_text(encoding='utf-8')) if index_path.exists() else {}
    try:
        urllib.request.urlopen(f'{ENGINE}/version', timeout=5)
    except OSError:
        sys.exit('VOICEVOX に接続できません。VOICEVOX を起動してから実行してください。')
    ffmpeg = shutil.which('ffmpeg')
    ext = 'mp3' if ffmpeg else 'wav'
    index = {}
    for pid, text in phrases.items():
        out = OUT / f'{pid}.{ext}'
        prev = old.get(pid)
        if not redo and out.exists() and prev and prev['text'] == text:
            index[pid] = prev
            continue
        query = json.loads(post('/audio_query', {'text': text, 'speaker': SPEAKER}))
        query.update(speedScale=SPEED, outputSamplingRate=SAMPLE_RATE, prePhonemeLength=0.05, postPhonemeLength=0.05)
        wav = post('/synthesis', {'speaker': SPEAKER}, query)
        if ffmpeg:
            subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-f', 'wav', '-i', '-', '-ac', '1', '-b:a', '48k', str(out)], input=wav, check=True)
        else:
            out.write_bytes(wav)
        index[pid] = {'file': out.name, 'text': text}
        print(f'{pid}: {text}')
    # 一覧から消えた文や、形式が変わった古いファイルは消す
    keep = {v['file'] for v in index.values()} | {'index.json'}
    for f in OUT.iterdir():
        if f.name not in keep:
            f.unlink()
            print(f'削除: {f.name}')
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('できました:', OUT)


if __name__ == '__main__':
    main()
