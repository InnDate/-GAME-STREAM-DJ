import yt_dlp
import urllib.parse

url = "https://www.youtube.com/watch?v=AYSM_upZDYk&list=PLTmomcjY1VRzlMUpuVu85YQrpuSrHOkej"

# Simulation of what main.py does
parsed = urllib.parse.urlparse(url)
params = urllib.parse.parse_qs(parsed.query)
if 'list' in params:
    clean_url = f"https://www.youtube.com/playlist?list={params['list'][0]}"
    print("Cleaned URL:", clean_url)
else:
    clean_url = url

ydl_opts = {
    'extract_flat': 'in_playlist',
    'quiet': True,
    'skip_download': True,
    'no_warnings': True,
    'ignoreerrors': True,
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(clean_url, download=False)
    
    if not info:
        print("No info returned")
    else:
        print("Type:", info.get('_type'))
        print("Title:", info.get('title'))
        entries = info.get('entries')
        if entries:
            # Note: entries is an iterator sometimes?
            entry_list = list(entries)
            print("Entries count:", len(entry_list))
            for e in entry_list[:5]:
                if e:
                    print(f"  - {e.get('id')}: {e.get('title')}")
        else:
            print("No entries found")
