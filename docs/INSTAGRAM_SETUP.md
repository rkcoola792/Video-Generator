# Instagram connection setup

This app connects Instagram Professional (Business or Creator) accounts through Instagram Login. It asks only for `instagram_business_basic` and `instagram_business_content_publish`. The Instagram Login setup does not require a linked Facebook Page. See [Meta's Instagram Login collection](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login).

## Configure your Meta app

1. Sign in to [Meta for Developers](https://developers.facebook.com/) and create an app for the Instagram API use case.
2. Add and configure the Instagram API with Instagram Login. Enable `instagram_business_basic` and `instagram_business_content_publish`.
3. Add this exact OAuth redirect URI to the Instagram Login settings:

   `http://localhost:4174/api/v1/social/instagram/callback`

   For hosted use, replace it with the app's public HTTPS callback URL and use the same value in `.env`.
4. In the Meta app roles/testers area, add the Instagram Professional account you will use for development, accept any invitation, and grant the requested permissions when connecting.
5. Copy the Meta App ID and App Secret into your local `.env`. Do not commit them or send them in chat.
6. Generate a separate encryption key in PowerShell:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Put the printed 64-character value in `TOKEN_ENCRYPTION_KEY`. This key encrypts Instagram access tokens stored in PostgreSQL. Keep a secure backup; changing it makes existing saved tokens unreadable.
7. Set these `.env` values and restart the app:

   ```dotenv
   INSTAGRAM_APP_ID=your-meta-app-id
   INSTAGRAM_APP_SECRET=your-meta-app-secret
   INSTAGRAM_REDIRECT_URI=http://localhost:4174/api/v1/social/instagram/callback
   INSTAGRAM_GRAPH_API_VERSION=v26.0
APP_BASE_URL=http://localhost:5173
   TOKEN_ENCRYPTION_KEY=your-generated-64-character-hex-key
   ```

## Before publishing

- Run the database migration with `npm run db:migrate` so the Instagram account and publishing tables exist.
- Ensure the finished MP4 is stored in R2. Instagram fetches it using a time-limited signed URL; local `.data` files cannot be fetched by Meta.
- In My videos, open a finished video, generate/edit the suggested caption, save and approve the exact video, connect Instagram, then use **Publish Reel now** and confirm the account and caption.
- A development-mode app can be restricted to app roles and testers. To connect accounts outside the app's tester setup, request the required permission access and app review through Meta.

Meta can change its app setup labels and review requirements. Check the current [Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) when configuring the app.
