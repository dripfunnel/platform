// next dev only: CSS url(media/<name>) to the theme-media dev route, url(<asset id>) to the proxied /shop-api/assets/{id},
// as the sandbox's bundlers write them for a build (storefront ARCHITECTURE §3.4).
/** @param {string} css */
export default function assetUrlLoader(css) {
  return css
    .replace(/url\(\s*(['"]?)media\/([A-Za-z0-9][A-Za-z0-9_-]{0,63}\.(?:png|jpg|jpeg|webp))\1\s*\)/g, 'url($1/theme-media/$2$1)')
    .replace(/url\(\s*(['"]?)([A-Za-z0-9_-]{1,128})\1\s*\)/g, 'url($1/shop-api/assets/$2$1)')
}
