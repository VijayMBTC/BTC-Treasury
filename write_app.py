import pathlib
src = pathlib.Path('/Users/vijay/btc-treasury/src/App.jsx')
print("Current size:", src.stat().st_size, "bytes")
print("Contains fearGreed:", "fearGreed" in src.read_text())
