import { NavLink } from 'react-router'
import { motion } from 'framer-motion'
import { NAV } from '@/lib/nav'
import { cn } from '@/lib/utils'

const tabs = NAV.filter((n) => n.tab)

/** Cover screen (< 600px): bottom tabs. */
export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md fold:hidden">
      <ul className="grid h-16 grid-cols-4">
        {tabs.map((item) => (
          <li key={item.path}>
            <NavLink to={item.path} end={item.path === '/'} className="flex h-full flex-col items-center justify-center gap-1">
              {({ isActive }) => (
                <>
                  <span className="relative grid h-7 w-12 place-items-center">
                    {isActive && (
                      <motion.span layoutId="tab-active" className="absolute inset-0 rounded-full bg-accent-soft" transition={{ type: 'spring', stiffness: 520, damping: 36 }} />
                    )}
                    <item.icon className={cn('relative size-[21px]', isActive ? 'text-accent' : 'text-subtle')} strokeWidth={1.9} />
                  </span>
                  <span className={cn('text-[11px] font-medium', isActive ? 'text-text' : 'text-subtle')}>{item.short}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
