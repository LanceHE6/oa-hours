import { useState } from 'react'
import { Button, Card, CardBody, Input } from '@nextui-org/react'
import { apiPost } from '../api'

interface Props {
  onLogin: () => void
}

export default function Login({ onLogin }: Props) {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await apiPost('/api/login', { account, password })
      onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-950 to-zinc-900 p-4">
      <Card className="w-full max-w-sm">
        <CardBody className="gap-4 p-8">
          <div className="mb-2 text-center">
            <h1 className="text-xl font-semibold">OA-Hours</h1>
            <p className="mt-1 text-sm text-default-500">登录 OA 查看工时统计</p>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Input
              label="OA 账号"
              value={account}
              onValueChange={setAccount}
              placeholder="域账号，如 H3056"
              isRequired
              autoFocus
            />
            <Input
              label="密码"
              type="password"
              value={password}
              onValueChange={setPassword}
              isRequired
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" color="primary" isLoading={loading}>
              登录
            </Button>
          </form>
          <p className="text-xs text-default-400">
            凭据仅加密保存在本机，用于会话过期后自动续登。
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
