from curl_cffi import requests as cf
r = cf.get("https://global.flashscore.ninja/2/x/feed/f_1_0_3_en_1", headers={"x-fsign":"SW9D1eZo"}, impersonate="chrome120", timeout=30)
text = r.text
print(f"Total len: {len(text)}")
# Print first 3000 chars raw để xem format
print(text[:3000])