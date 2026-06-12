import { NavLink } from 'react-router-dom'
import { clsx } from 'clsx'

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/yolo', label: 'YOLO' },
  { to: '/review', label: 'Review' },
]

export function Nav() {
  return (
    <nav className="flex gap-1.5 flex-wrap">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          className={({ isActive }) =>
            clsx(
              'relative px-3 py-1.5 rounded-md text-sm border transition-all duration-200',
              isActive
                ? 'bg-mc-purple/10 border-mc-purple/30 text-mc-purple font-medium'
                : 'bg-mc-surface border-mc-border text-mc-text-muted hover:border-mc-accent hover:text-mc-accent',
            )
          }
        >
          {({ isActive }) => (
            <>
              {l.label}
              {isActive && (
                <span className="absolute -bottom-[1px] left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full bg-mc-purple" />
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
