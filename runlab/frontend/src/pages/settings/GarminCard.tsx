import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import { ko } from 'date-fns/locale'
import { KeyRound, Link2, Loader2, LogOut, ShieldCheck, Watch } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { useGarminLogin, useGarminLogout, useGarminMfa, useGarminStatus } from '@/api/garmin'

function ErrorText({ error }: { error: Error | null }) {
  if (!error) return null
  return <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{error.message}</p>
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useGarminLogin()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ email, password }, { onSettled: () => setPassword('') })
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <Label htmlFor="g-email">가민 커넥트 이메일</Label>
        <Input id="g-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="g-pw">비밀번호</Label>
        <Input id="g-pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-good" />
        비밀번호는 로그인에만 쓰이고 저장되지 않아요. 이 PC의 사용자 폴더에 세션 토큰만 보관됩니다.
      </div>
      <ErrorText error={login.error} />
      <Button type="submit" variant="primary" className="w-full" disabled={login.isPending}>
        {login.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
        {login.isPending ? '연결 중…' : '가민 계정 연결'}
      </Button>
    </form>
  )
}

function MfaForm() {
  const [code, setCode] = useState('')
  const mfa = useGarminMfa()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mfa.mutate(code)
      }}
      className="space-y-3"
    >
      <div className="flex items-center gap-3 rounded-xl bg-accent-soft px-4 py-3">
        <KeyRound className="size-5 text-accent" />
        <p className="text-sm">가민이 이메일 또는 문자로 보낸 인증 코드를 입력하세요.</p>
      </div>
      <Input
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        maxLength={8}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        className="num h-14 text-center text-2xl font-semibold tracking-[0.4em]"
      />
      <ErrorText error={mfa.error} />
      <Button type="submit" variant="primary" className="w-full" disabled={mfa.isPending || code.length < 4}>
        {mfa.isPending && <Loader2 className="animate-spin" />}
        인증 완료
      </Button>
    </form>
  )
}

function Connected({ name, lastSync }: { name: string; lastSync: string | null }) {
  const logout = useGarminLogout()
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="grid size-12 place-items-center rounded-full bg-gradient-to-br from-accent to-fatigue text-lg font-bold text-white">
        {name.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-semibold">
          {name}
          <span className="rounded-full bg-good/15 px-2 py-0.5 text-[11px] font-medium text-good">연결됨</span>
        </div>
        <div className="mt-0.5 text-xs text-subtle">
          {lastSync
            ? `마지막 동기화 ${formatDistanceToNow(new Date(lastSync), { addSuffix: true, locale: ko })}`
            : '아직 동기화하지 않았어요'}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
        <LogOut />
        연결 해제
      </Button>
    </div>
  )
}

export function GarminCard() {
  const { data, isLoading } = useGarminStatus()
  const view = isLoading ? 'loading' : data?.connected ? 'connected' : data?.mfa_pending ? 'mfa' : 'login'

  return (
    <Card>
      <CardHeader
        title="가민 커넥트"
        hint="활동·수면·HRV·안정 심박을 자동으로 가져옵니다"
        action={
          <div className="grid size-8 place-items-center rounded-lg bg-surface-2 text-fitness">
            <Watch className="size-4" />
          </div>
        }
      />
      <CardBody>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {view === 'loading' && <div className="h-24 animate-pulse rounded-xl bg-surface-2" />}
            {view === 'login' && <LoginForm />}
            {view === 'mfa' && <MfaForm />}
            {view === 'connected' && (
              <Connected name={data?.full_name || data?.display_name || '러너'} lastSync={data?.last_sync ?? null} />
            )}
          </motion.div>
        </AnimatePresence>
      </CardBody>
    </Card>
  )
}
