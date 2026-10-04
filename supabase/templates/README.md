# メールの文面

Supabase の Authentication → Emails → Templates に貼る。

| テンプレート | 件名 | 本文 |
|---|---|---|
| Magic link | ふくいエキマエ｜ログイン用のリンク | `magic_link.html` |
| Invite user | ふくいエキマエ｜お店の管理画面へのご招待 | `invite.html` |

招待メールの `{{ .Data.invited_shop }}` には、Edge Function invite-owner が店名を入れる。
