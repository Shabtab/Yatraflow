// ============ My trips — planner avatars ============
// The other members of a trip as a small stack, or a plain "Just you so far".
// The stack is one labelled image, so a screen reader hears the names once.
import { Avatar } from '../ui'
import type { Trip, User } from '../../data/types'

const MAX_AVATARS = 3

function userOf(users: User[], id: string): User | undefined {
  return users.find(candidate => candidate.id === id)
}

export function Planners({ trip, users, meId }: { trip: Trip; users: User[]; meId: string | null }) {
  const others = (trip.members ?? []).filter(member => member.userId !== meId)
  if (others.length === 0) return <span className="mt-solo">Just you so far</span>
  const names = others.map(member => userOf(users, member.userId)?.profile.name ?? 'A planner').join(', ')
  return (
    <span className="member-stack mt-planners" role="img" aria-label={`Also planning: ${names}`}>
      {others.slice(0, MAX_AVATARS).map(member => <Avatar key={member.userId} user={userOf(users, member.userId)} />)}
      {others.length > MAX_AVATARS && <span className="small muted num" aria-hidden="true">+{others.length - MAX_AVATARS}</span>}
    </span>
  )
}
