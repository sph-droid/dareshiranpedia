/* 誰もしらんペディア 公開設定
   Turnstile（スパム対策）を使う場合のみ、Cloudflare で取得した
   「サイトキー」を下の turnstileSiteKey に貼ってください。
   空のままなら Turnstile は無効です（サーバー側の TURNSTILE_SECRET も
   未設定にしてください。片方だけ設定すると投稿が失敗します）。
   これは公開してよいキーです。秘密のキーはここに書かないでください。 */
window.DARESHI_CONFIG = {
  turnstileSiteKey: ""
};
