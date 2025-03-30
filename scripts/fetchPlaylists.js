const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const OUTPUT_PATH = path.join(__dirname, '../data/playlists.json');

const fetchPlaylists = async () => {
  let playlists = [];
  let nextPageToken = '';
  const baseUrl = 'https://www.googleapis.com/youtube/v3/playlists';

  do {
    const url = `${baseUrl}?part=snippet&channelId=${CHANNEL_ID}&maxResults=50&pageToken=${nextPageToken}&key=${API_KEY}`;

    const res = await new Promise((resolve, reject) => {
      https.get(url, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    if (res.items) {
      playlists = playlists.concat(res.items.map(item => ({
        id: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
        thumbnails: item.snippet.thumbnails
      })));
    }

    nextPageToken = res.nextPageToken || '';
  } while (nextPageToken);

  const output = {
    last_updated: new Date().toISOString(),
    total_playlists: playlists.length,
    playlists
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`✅ Wrote ${playlists.length} playlists to playlists.json`);
};

fetchPlaylists().catch(err => {
  console.error('❌ Error fetching playlists:', err);
  process.exit(1);
});
