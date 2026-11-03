import os from 'node:os';
import { AppPaths } from './AppPaths';
import type { SystemInfo } from '@ipm/shared';

export class SystemInfoService {
  public static getSystemInfo(): SystemInfo {
    const paths = AppPaths.get();
    let osUsername = 'User';
    try {
      osUsername = os.userInfo().username || process.env.USERNAME || 'User';
    } catch {
      osUsername = process.env.USERNAME || 'User';
    }

    const computerName = os.hostname() || process.env.COMPUTERNAME || 'WINDOWS-PC';

    const rawInterfaces = os.networkInterfaces();
    const networkInterfaces: SystemInfo['networkInterfaces'] = [];

    Object.entries(rawInterfaces).forEach(([name, ifaces]) => {
      if (!ifaces) return;
      ifaces.forEach((iface) => {
        // We focus on IPv4 interfaces
        if (iface.family === 'IPv4') {
          networkInterfaces.push({
            name,
            address: iface.address,
            netmask: iface.netmask,
            family: iface.family,
            mac: iface.mac,
            internal: iface.internal,
          });
        }
      });
    });

    return {
      osUsername,
      computerName,
      platform: os.platform(),
      arch: os.arch(),
      networkInterfaces,
      paths: {
        appData: paths.appData,
        data: paths.data,
        attachments: paths.attachments,
        transfers: paths.transfers,
        avatars: paths.avatars,
        logs: paths.logs,
        security: paths.security,
      },
    };
  }
}
