import { Context, Schema } from 'koishi'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// 声明配置接口
export interface Config {
  host: string
  port: number
  username: string
  password: string
  disableSudo: boolean
  disableRm: boolean
  allowedUsers: string[]
  maxOutputLength: number
}

// 定义配置 schema
export const Config: Schema<Config> = Schema.object({
  host: Schema.string().required().description('SSH服务器地址'),
  port: Schema.number().default(22).description('SSH端口'),
  username: Schema.string().required().description('SSH用户名'),
  password: Schema.string().required().role('secret').description('SSH密码'),
  disableSudo: Schema.boolean().default(true).description('禁用sudo命令'),
  disableRm: Schema.boolean().default(true).description('禁用rm命令'),
  allowedUsers: Schema.array(Schema.string()).description('允许使用插件的用户ID'),
  maxOutputLength: Schema.number().default(2000).description('最大输出长度')
})

// 导出插件名称
export const name = 'userssh'

// 主插件逻辑
export function apply(ctx: Context, config: Config) {
  // 存储活跃的SSH会话
  const activeSessions = new Map<string, any>()

  // 注册ssh命令
  ctx.command('ssh <command:text>')
    .action(async ({ session }, command) => {
      if (!command) {
        return '请输入要执行的命令。用法: ssh <command>'
      }

      // 检查用户权限
      if (config.allowedUsers && config.allowedUsers.length > 0) {
        if (!config.allowedUsers.includes(session.userId)) {
          return '您没有权限使用SSH功能'
        }
      }

      // 安全检查
      if (config.disableSudo && command.includes('sudo')) {
        return 'sudo命令已被禁用'
      }

      if (config.disableRm && command.trim().startsWith('rm')) {
        return 'rm命令已被禁用'
      }

      try {
        // 执行SSH命令
        const result = await executeSSHCommand(command, config)

        // 限制输出长度
        if (result.length > config.maxOutputLength) {
          return `输出过长，已截断:\n${result.substring(0, config.maxOutputLength)}...`
        }

        return `执行结果:\n${result}`
      } catch (error) {
        return `SSH命令执行失败: ${error.message}`
      }
    })

  // 注册服务器状态命令
  ctx.command('ssh-status')
    .action(async ({ session }) => {
      const userId = session.userId
      const isActive = activeSessions.has(userId)

      return `SSH服务器状态:
服务器: ${config.host}:${config.port}
用户: ${config.username}
您的会话: ${isActive ? '活跃' : '未连接'}`
    })

  // 注册连接测试命令
  ctx.command('ssh-test')
    .action(async ({ session }) => {
      try {
        await session.send('正在测试SSH连接...')
        const result = await executeSSHCommand('echo "连接测试成功"', config)
        return `连接测试成功! 服务器响应:\n${result}`
      } catch (error) {
        return `连接测试失败: ${error.message}`
      }
    })

  // 清理会话
  ctx.on('dispose', () => {
    activeSessions.clear()
  })
}

// SSH命令执行函数
async function executeSSHCommand(command: string, config: Config): Promise<string> {
  // 构建SSH命令
  const sshCommand = `sshpass -p '${config.password}' ssh -o StrictHostKeyChecking=no -p ${config.port} ${config.username}@${config.host} "${escapeCommand(command)}"`

  try {
    const { stdout, stderr } = await execAsync(sshCommand, { timeout: 30000 })

    if (stderr && !stderr.includes('Warning: Permanently added')) {
      throw new Error(stderr)
    }

    return stdout || '命令执行成功(无输出)'
  } catch (error) {
    if (error.code === 'ETIMEDOUT') {
      throw new Error('SSH连接超时')
    }
    throw new Error(`SSH错误: ${error.stderr || error.message}`)
  }
}

// 转义命令中的特殊字符
function escapeCommand(command: string): string {
  return command.replace(/(["$`\\])/g, '\\$1')
}
