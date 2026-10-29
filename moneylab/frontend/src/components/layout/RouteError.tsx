import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function NotFound() {
  return <ErrorView notFound message="" />
}

export function RouteError() {
  const err = useRouteError()
  const notFound = isRouteErrorResponse(err) && err.status === 404
  const message = isRouteErrorResponse(err) ? err.statusText : err instanceof Error ? err.message : String(err)
  return <ErrorView notFound={notFound} message={message} />
}

function ErrorView({ notFound, message }: { notFound: boolean; message: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-bad/10 text-bad">
          <TriangleAlert className="size-6" />
        </div>
        <h1 className="mt-4 text-lg font-semibold">{notFound ? '페이지를 찾을 수 없어요' : '화면을 그리다 문제가 생겼어요'}</h1>
        {!notFound && <p className="mt-2 break-words text-sm text-subtle">{message}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RotateCcw /> 다시 시도
          </Button>
          <Link to="/">
            <Button variant="primary">홈으로 가기</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
