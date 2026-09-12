import { spawn } from 'child_process';
import { OrcaDelivery, OrcaMessage } from './types';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ExecFunction = (command: string, args: string[], options?: { cwd?: string; timeout?: number }) => Promise<ExecResult>;

export async function defaultExec(
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number }
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | null = null;

    if (options?.timeout && options.timeout > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command ${command} timed out after ${options.timeout}ms`));
      }, options.timeout);
    }

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

export class OrcaClient {
  private bin: string;
  private execFn: ExecFunction;
  private cwd: string;

  constructor(options?: { command?: string; execFn?: ExecFunction; cwd?: string }) {
    this.bin = options?.command || 'orca';
    this.execFn = options?.execFn || defaultExec;
    this.cwd = options?.cwd || process.cwd();
  }

  private parseJsonOutput<T = any>(rawStdout: string, cmdDesc: string): T {
    const trimmed = rawStdout.trim();
    if (!trimmed) {
      throw new Error(`Orca command [${cmdDesc}] returned empty output`);
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.ok === false) {
        throw new Error(parsed.error?.message || parsed.error || `Orca command [${cmdDesc}] failed with ok: false`);
      }
      return parsed.result ?? parsed;
    } catch (err: any) {
      // Find JSON block if there's trailing or leading noise
      const jsonStart = trimmed.indexOf('{');
      const jsonEnd = trimmed.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        try {
          const slice = trimmed.slice(jsonStart, jsonEnd + 1);
          const parsed = JSON.parse(slice);
          if (parsed.ok === false) {
            throw new Error(parsed.error?.message || parsed.error || `Orca command [${cmdDesc}] failed`);
          }
          return parsed.result ?? parsed;
        } catch {
          // fall through
        }
      }
      throw new Error(`Failed to parse Orca JSON from [${cmdDesc}]: ${err.message}. Raw output: ${trimmed.slice(0, 300)}`);
    }
  }

  async runCreate(options: { objective: string; from?: string }): Promise<{ id: string }> {
    const args = ['orchestration', 'run-create', '--objective', options.objective, '--json'];
    if (options.from) args.push('--from', options.from);

    const res = await this.execFn(this.bin, args, { cwd: this.cwd });
    if (res.exitCode !== 0) {
      throw new Error(`run-create failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    const data = this.parseJsonOutput<{ run?: { id: string }; id?: string }>(res.stdout, 'run-create');
    const runId = data.run?.id || data.id;
    if (!runId) throw new Error(`run-create response missing run id: ${res.stdout}`);
    return { id: runId };
  }

  async taskCreate(options: {
    spec: string;
    taskTitle?: string;
    deps?: string[];
    runId?: string;
  }): Promise<{ id: string }> {
    const args = ['orchestration', 'task-create', '--spec', options.spec, '--json'];
    if (options.taskTitle) args.push('--task-title', options.taskTitle);
    if (options.runId) args.push('--run', options.runId);
    if (options.deps && options.deps.length > 0) {
      args.push('--deps', JSON.stringify(options.deps));
    }

    const res = await this.execFn(this.bin, args, { cwd: this.cwd });
    if (res.exitCode !== 0) {
      throw new Error(`task-create failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    const data = this.parseJsonOutput<{ task?: { id: string }; id?: string }>(res.stdout, 'task-create');
    const taskId = data.task?.id || data.id;
    if (!taskId) throw new Error(`task-create response missing task id: ${res.stdout}`);
    return { id: taskId };
  }

  async workerStart(options: {
    taskId: string;
    agent: string;
    worktree?: string;
    runId?: string;
    taskTitle?: string;
    timeoutMs?: number;
  }): Promise<{ dispatchId: string; terminalHandle?: string }> {
    const args = [
      'orchestration',
      'worker-start',
      '--task',
      options.taskId,
      '--agent',
      options.agent,
      '--worktree',
      options.worktree || 'active',
      '--json',
    ];
    if (options.runId) args.push('--run', options.runId);
    if (options.taskTitle) args.push('--task-title', options.taskTitle);
    if (options.timeoutMs) args.push('--timeout-ms', String(options.timeoutMs));

    const res = await this.execFn(this.bin, args, { cwd: this.cwd });
    if (res.exitCode !== 0) {
      throw new Error(`worker-start failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    const data = this.parseJsonOutput<{ dispatch?: { id: string }; dispatchId?: string; terminal?: { handle: string }; terminalHandle?: string }>(
      res.stdout,
      'worker-start'
    );
    const dispatchId = data.dispatch?.id || data.dispatchId || '';
    const terminalHandle = data.terminal?.handle || data.terminalHandle;
    return { dispatchId, terminalHandle };
  }

  async terminalCreate(options: {
    worktree?: string;
    title?: string;
    command?: string;
  }): Promise<{ handle: string }> {
    const args = ['terminal', 'create', '--worktree', options.worktree || 'active', '--json'];
    if (options.title) args.push('--title', options.title);
    if (options.command) args.push('--command', options.command);

    const res = await this.execFn(this.bin, args, { cwd: this.cwd });
    if (res.exitCode !== 0) {
      throw new Error(`terminal create failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    const data = this.parseJsonOutput<{ terminal?: { handle: string }; handle?: string }>(res.stdout, 'terminal create');
    const handle = data.terminal?.handle || data.handle;
    if (!handle) throw new Error(`terminal create missing handle: ${res.stdout}`);
    return { handle };
  }

  async dispatch(options: {
    taskId: string;
    toHandle: string;
    inject?: boolean;
    runId?: string;
  }): Promise<{ dispatchId: string }> {
    const args = ['orchestration', 'dispatch', '--task', options.taskId, '--to', options.toHandle, '--json'];
    if (options.inject === true) args.push('--inject');
    if (options.runId) args.push('--run', options.runId);

    const res = await this.execFn(this.bin, args, { cwd: this.cwd });
    if (res.exitCode !== 0) {
      throw new Error(`dispatch failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    const data = this.parseJsonOutput<{ dispatch?: { id: string }; dispatchId?: string }>(res.stdout, 'dispatch');
    const dispatchId = data.dispatch?.id || data.dispatchId || '';
    return { dispatchId };
  }

  async terminalSend(options: {
    handle: string;
    text: string;
    enter?: boolean;
  }): Promise<{ ok: boolean }> {
    const args = ['terminal', 'send', '--terminal', options.handle, '--text', options.text, '--json'];
    if (options.enter !== false) args.push('--enter');

    const res = await this.execFn(this.bin, args, { cwd: this.cwd });
    if (res.exitCode !== 0) {
      throw new Error(`terminal send failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }
    return { ok: true };
  }

  async check(options: {
    runId?: string;
    terminalHandle?: string;
    wait?: boolean;
    timeoutMs?: number;
    ackDeliveryId?: string;
    types?: string[];
  }): Promise<OrcaDelivery | null> {
    const args = ['orchestration', 'check', '--json'];
    if (options.runId) args.push('--run', options.runId);
    if (options.terminalHandle) args.push('--terminal', options.terminalHandle);
    if (options.wait) args.push('--wait');
    if (options.timeoutMs) args.push('--timeout-ms', String(options.timeoutMs));
    if (options.ackDeliveryId) args.push('--ack', options.ackDeliveryId);
    if (options.types && options.types.length > 0) {
      args.push('--types', options.types.join(','));
    }

    const res = await this.execFn(this.bin, args, { cwd: this.cwd });
    if (res.exitCode !== 0) {
      // If wait timed out or empty delivery
      if (res.stderr.includes('timeout') || res.stdout.includes('timeout')) {
        return null;
      }
      throw new Error(`orchestration check failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    try {
      const data = this.parseJsonOutput<{ delivery?: OrcaDelivery; messages?: OrcaMessage[]; delivery_id?: string }>(
        res.stdout,
        'orchestration check'
      );

      if (data.delivery) return data.delivery;
      if (Array.isArray(data.messages)) {
        return {
          delivery_id: data.delivery_id,
          messages: data.messages,
        };
      }
      return null;
    } catch (e: any) {
      if (res.stdout.trim() === '' || res.stdout.includes('null')) return null;
      throw e;
    }
  }

  async send(options: {
    subject: string;
    body?: string;
    to?: string;
    runId?: string;
    type?: string;
    taskId?: string;
    dispatchId?: string;
    outcome?: 'succeeded' | 'failed';
    filesModified?: string;
    reportPath?: string;
  }): Promise<{ ok: boolean }> {
    const args = ['orchestration', 'send', '--subject', options.subject, '--json'];
    if (options.to) args.push('--to', options.to);
    if (options.runId) args.push('--run', options.runId);
    if (options.body) args.push('--body', options.body);
    if (options.type) args.push('--type', options.type);
    if (options.taskId) args.push('--task-id', options.taskId);
    if (options.dispatchId) args.push('--dispatch-id', options.dispatchId);
    if (options.outcome) args.push('--outcome', options.outcome);
    if (options.filesModified) args.push('--files-modified', options.filesModified);
    if (options.reportPath) args.push('--report-path', options.reportPath);

    const res = await this.execFn(this.bin, args, { cwd: this.cwd });
    if (res.exitCode !== 0) {
      throw new Error(`orchestration send failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }
    return { ok: true };
  }

  async workerStop(options: { dispatchId: string }): Promise<{ ok: boolean }> {
    const args = ['orchestration', 'worker-stop', '--dispatch', options.dispatchId, '--json'];
    const res = await this.execFn(this.bin, args, { cwd: this.cwd });
    return { ok: res.exitCode === 0 };
  }
}
