const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const OUTPUT_PATH = path.join(__dirname, '../data/playlists.json');

const fetchJson = (url) =>
  new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });

const fetchAllPages = async (urlBuilder) => {
  let results = [];
  let nextPageToken = '';
  do {
    const url = urlBuilder(nextPageToken);
    const json = await fetchJson(url);
    results = results.concat(json.items || []);
    nextPageToken = json.nextPageToken || '';
  } while (nextPageToken);
  return results;
};

const fetchAllPlaylists = async () => {
  return await fetchAllPages((token) =>
    `https://www.googleapis.com/youtube/v3/playlists?part=snippet&channelId=${CHANNEL_ID}&maxResults=50&pageToken=${token}&key=${API_KEY}`
  );
};

const fetchVideosForPlaylist = async (playlistId) => {
  return await fetchAllPages((token) =>
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&pageToken=${token}&key=${API_KEY}`
  );
};

const run = async () => {
  console.log('🔄 Fetching playlists...');
  const playlistsRaw = await fetchAllPlaylists();

  const playlists = [];

  for (const pl of playlistsRaw) {
    const plMeta = {
      id: pl.id,
      title: pl.snippet.title,
      description: pl.snippet.description,
      publishedAt: pl.snippet.publishedAt,
      thumbnails: pl.snippet.thumbnails,
      videos: [],
    };

    console.log(`▶ Fetching videos in playlist: ${plMeta.title}`);
    const videosRaw = await fetchVideosForPlaylist(pl.id);

    const videos = videosRaw.map((v) => {
      const s = v.snippet;
      return {
        videoId: s.resourceId?.videoId,
        title: s.title,
        position: s.position,
        publishedAt: s.publishedAt,
        thumbnail: s.thumbnails?.default?.url || '',
        embedUrl: `https://www.youtube.com/embed/${s.resourceId?.videoId}`,
      };
    });

    plMeta.videos = videos;
    playlists.push(plMeta);
  }

  const output = {
    last_updated: new Date().toISOString(),
    channel_id: CHANNEL_ID,
    total_playlists: playlists.length,
    playlists,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`✅ Done. Saved ${playlists.length} playlists.`);
};

run().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
