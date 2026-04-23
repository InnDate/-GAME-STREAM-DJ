import yt_dlp

url = "https://www.youtube.com/playlist?list=PLTmomcjY1VRzlMUpuVu85YQrpuSrHOkej"

ydl_opts = {
    'extract_flat': 'in_playlist',
    'quiet': True,
    'skip_download': True,
    'no_warnings': True,
    'ignoreerrors': True,
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=False)
    
    if not info:
        print("No info returned")
    else:
        print("Type:", info.get('_type'))
        print("Title:", info.get('title'))
        entries = info.get('entries')
        if entries:
            entry_list = list(entries)
            print("Entries count:", len(entry_list))
            for e in entry_list[:5]:
                if e:
                    print(f"  - {e.get('id')}: {e.get('title')}")
        else:
            print("No entries found")
            print("Keys:", list(info.keys()))
            print("ID:", info.get('id'))
