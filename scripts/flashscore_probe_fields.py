from curl_cffi import requests as cf
SEP_EVENT="~"; SEP_FIELD="\u00ac"; SEP_KV="\u00f7"

r = cf.get("https://global.flashscore.ninja/2/x/feed/f_1_0_3_en_1",
           headers={"x-fsign":"SW9D1eZo"}, impersonate="chrome120", timeout=20)
text = r.text
events = text.split(SEP_EVENT)

# Tìm 1 match có đủ field
for ev in events:
    fields = {}
    for f in ev.split(SEP_FIELD):
        if SEP_KV in f:
            k,v = f.split(SEP_KV,1)
            fields[k] = v
    if "AA" in fields and "AE" in fields and "AF" in fields:
        print(f"Match: {fields.get('AE')} vs {fields.get('AF')}")
        print(f"Total fields: {len(fields)}")
        print("All keys:", sorted(fields.keys()))
        print()
        print("Full field dump:")
        for k in sorted(fields.keys()):
            v = fields[k][:100]
            print(f"  {k} = {v}")
        break