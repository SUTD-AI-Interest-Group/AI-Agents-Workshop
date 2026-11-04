import type { CrewInfo, OnlineUser } from '../../shared/protocol'

export function PresenceList({ users, crews, me }: { users: OnlineUser[]; crews: CrewInfo[]; me: string }) {
  return (
    <div className="presence">
      <div className="presence-row">
        {users.map((u) => (
          <span key={u.userId} className="chip" title={u.name}>
            <span className="dot on" />
            {u.name}
            {u.userId === me && <span className="muted"> (you)</span>}
          </span>
        ))}
      </div>
      {crews.length > 0 && (
        <div className="presence-row">
          {crews.map((c) => (
            <span key={c.id} className="chip crew" title={c.online ? `${c.name} is online` : `${c.name} is offline`}>
              <span className={c.online ? 'dot on' : 'dot'} />
              🤖 {c.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
