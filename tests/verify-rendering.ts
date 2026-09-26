import http from 'http';

function fetchUrl(urlStr: string): Promise<{ status: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(urlStr, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 500,
          contentType: res.headers['content-type'] || '',
          body: data,
        });
      });
    }).on('error', reject);
  });
}

async function check() {
  console.log('Fetching http://localhost:3000/setup/users ...');
  const page = await fetchUrl('http://localhost:3000/setup/users');
  console.log('Page Status:', page.status);
  console.log('Page Content-Type:', page.contentType);

  const cssMatch = page.body.match(/href="(\/_next\/static\/css\/[^"]+)"/);
  if (!cssMatch) {
    console.error('No CSS stylesheet link found in HTML!');
    process.exit(1);
  }

  const cssUrl = 'http://localhost:3000' + cssMatch[1];
  console.log('Found CSS URL:', cssUrl);

  const css = await fetchUrl(cssUrl);
  console.log('CSS Status:', css.status);
  console.log('CSS Content-Type:', css.contentType);
  console.log('CSS Length:', css.body.length);
  console.log('CSS Sample:\n', css.body.substring(0, 300));

  if (css.status === 200 && css.contentType.includes('text/css') && css.body.includes('--font-sans') && css.body.length > 5000) {
    console.log('\n SUCCESS: CSS STYLESHEET LOADED PROPERLY WITH TAILWIND STYLES!');
  } else {
    console.error('\n FAILURE: CSS not loaded correctly.');
    process.exit(1);
  }
}

check().catch(console.error);
