/**
 * Daemon doctor utilities
 * 
 * Process discovery and cleanup functions for the daemon
 * Helps diagnose and fix issues with hung or orphaned processes
 */

import psList from 'ps-list';
import spawn from 'cross-spawn';

/**
 * Find all Happy CLI processes (including current process)
 */
export async function findAllHappyProcesses(): Promise<Array<{ pid: number, command: string, type: string }>> {
  try {
    const processes = await psList();
    const allProcesses: Array<{ pid: number, command: string, type: string }> = [];
    
    for (const proc of processes) {
      const cmd = proc.cmd || '';
      const name = proc.name || '';
      
      // Check if it's a Happy process
      const isHappy = name.includes('happy') || 
                      name === 'node' && (cmd.includes('happy-cli') || cmd.includes('dist/index.mjs')) ||
                      cmd.includes('happy.mjs') ||
                      cmd.includes('happy-coder') ||
                      (cmd.includes('tsx') && cmd.includes('src/index.ts') && cmd.includes('happy-cli'));
      
      if (!isHappy) continue;

      // Classify process type
      let type = 'unknown';
      if (proc.pid === process.pid) {
        type = 'current';
      } else if (cmd.includes('--version')) {
        type = cmd.includes('tsx') ? 'dev-daemon-version-check' : 'daemon-version-check';
      } else if (cmd.includes('daemon start-sync') || cmd.includes('daemon start')) {
        type = cmd.includes('tsx') ? 'dev-daemon' : 'daemon';
      } else if (cmd.includes('--started-by daemon')) {
        type = cmd.includes('tsx') ? 'dev-daemon-spawned' : 'daemon-spawned-session';
      } else if (cmd.includes('doctor')) {
        type = cmd.includes('tsx') ? 'dev-doctor' : 'doctor';
      } else if (cmd.includes('--yolo')) {
        type = 'dev-session';
      } else {
        type = cmd.includes('tsx') ? 'dev-related' : 'user-session';
      }

      allProcesses.push({ pid: proc.pid, command: cmd || name, type });
    }

    return allProcesses;
  } catch (error) {
    return [];
  }
}

/**
 * Find all runaway Happy CLI processes that should be killed
 */
export async function findRunawayHappyProcesses(): Promise<Array<{ pid: number, command: string }>> {
  const allProcesses = await findAllHappyProcesses();
  
  // Filter to just runaway processes (excluding current process)
  return allProcesses
    .filter(p => 
      p.pid !== process.pid && (
        p.type === 'daemon' ||
        p.type === 'dev-daemon' ||
        p.type === 'daemon-spawned-session' ||
        p.type === 'dev-daemon-spawned' ||
        p.type === 'daemon-version-check' ||
        p.type === 'dev-daemon-version-check'
      )
    )
    .map(p => ({ pid: p.pid, command: p.command }));
}

/**
 * Kill all runaway Happy CLI processes
 */
export async function killRunawayHappyProcesses(): Promise<{ killed: number, errors: Array<{ pid: number, error: string }> }> {
  const runawayProcesses = await findRunawayHappyProcesses();
  const errors: Array<{ pid: number, error: string }> = [];
  let killed = 0;
  
  for (const { pid, command } of runawayProcesses) {
    try {
      console.log(`Killing runaway process PID ${pid}: ${command}`);
      
      if (process.platform === 'win32') {
        // Windows: use taskkill
        const result = spawn.sync('taskkill', ['/F', '/PID', pid.toString()], { stdio: 'pipe' });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`taskkill exited with code ${result.status}`);
      } else {
        // Unix: try SIGTERM first
        process.kill(pid, 'SIGTERM');
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check if still alive
        const processes = await psList();
        const stillAlive = processes.find(p => p.pid === pid);
        if (stillAlive) {
          console.log(`Process PID ${pid} ignored SIGTERM, using SIGKILL`);
          process.kill(pid, 'SIGKILL');
        }
      }
      
      console.log(`Successfully killed runaway process PID ${pid}`);
      killed++;
    } catch (error) {
      const errorMessage = (error as Error).message;
      errors.push({ pid, error: errorMessage });
      console.log(`Failed to kill process PID ${pid}: ${errorMessage}`);
    }
  }

  return { killed, errors };
}