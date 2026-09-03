import { useState } from 'react'
import { Button, Card, CardBody, Input, Switch } from '@nextui-org/react'
import type { DataProvider } from '../provider'

interface Props {
  provider: DataProvider
  onLogin: () => void
}

// 浏览器本地存储 Key（仅登录成功后写入账号密码）。
const REMEMBER_KEY = 'oa_hours_remember'
const ACCOUNT_KEY = 'oa_hours_account'
const PASSWORD_KEY = 'oa_hours_password'

export default function Login({ provider, onLogin }: Props) {
  // 打开登录页时从浏览器本地读取上次保存的账号密码，自动填充输入框。
  const [account, setAccount] = useState(() => localStorage.getItem(ACCOUNT_KEY) ?? '')
  const [password, setPassword] = useState(() => localStorage.getItem(PASSWORD_KEY) ?? '')
  const [remember, setRemember] = useState(() => localStorage.getItem(REMEMBER_KEY) === '1')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const toggleRemember = (on: boolean) => {
    setRemember(on)
    if (on) {
      // 开关状态持久化；账号密码等登录成功后写入。
      localStorage.setItem(REMEMBER_KEY, '1')
    } else {
      // 关闭时清除已保存的账号密码，之后不再自动填充（换账号/公共设备场景）。
      localStorage.removeItem(REMEMBER_KEY)
      localStorage.removeItem(ACCOUNT_KEY)
      localStorage.removeItem(PASSWORD_KEY)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await provider.login(account, password)
      if (remember) {
        // 登录成功后才保存，避免错误密码污染已存凭据。
        localStorage.setItem(ACCOUNT_KEY, account)
        localStorage.setItem(PASSWORD_KEY, password)
        localStorage.setItem(REMEMBER_KEY, '1')
      }
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
            <h1 className="text-xl font-semibold">Macrosan OA Hours</h1>
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
            <div className="flex justify-end">
              <Switch size="sm" isSelected={remember} onValueChange={toggleRemember}>
                记住我
              </Switch>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" color="primary" isLoading={loading}>
              登录
            </Button>
          </form>
          <p className="text-xs text-default-400">
            凭据仅保存在本机，用于会话过期后自动续登。
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
