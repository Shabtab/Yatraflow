export function profileSession<T extends { user: { id: string } }>(session: T, sessionId = '11111111-1111-4111-8111-111111111111') {
  const payload = Buffer.from(JSON.stringify({ sub: session.user.id, session_id: sessionId })).toString('base64url')
  return { ...session, access_token: `e30.${payload}.synthetic` }
}
