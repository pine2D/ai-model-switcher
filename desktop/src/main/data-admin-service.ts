import type { SyncStatus } from "../shared/sync";
import type { DesktopDatabase } from "./database";

interface DataAdminSync {
  disconnect(): Promise<SyncStatus>;
  status(): SyncStatus;
}

interface DataAdminOptions {
  readonly database: DesktopDatabase;
  readonly deviceId: () => string;
  readonly sync: DataAdminSync;
  readonly now?: () => number;
}

// 本机数据管理。两类语义刻意不同：
// - 清空历史 / 清空结果库：走既有的 tombstone 路径（写 deletedAt + 入 outbox），删除会同步到其它设备——
//   这是「删除一律 tombstone」的正常用法，否则其它设备会把记录同步回来。
// - 重置全部本机数据：只清本机、不动 Google Drive。先断开连接，再物理清空本机库（本应用唯一的物理删除路径）。
//   这里不能用 tombstone：tombstone 比云端记录新，重新连接后会赢过云端副本并上传，等于把云端也删了，
//   与 README「重置不会删除云端数据」的承诺相反。deviceId 保留：localStateFragment 用它找回本机在云端的
//   旧 fragment，继承本机不建模的设置键；换掉 deviceId 会让重置后首轮上传把那些键整体丢掉。
export class DataAdminService {
  private readonly now: () => number;

  constructor(private readonly options: DataAdminOptions) {
    this.now = options.now ?? Date.now;
  }

  clearHistory(): number {
    let cleared = 0;
    // list() 单次最多 100 条且不含 tombstone：逐批 tombstone 到列表为空，不另写 SQL。
    for (;;) {
      const batch = this.options.database.history.list(100);
      if (!batch.length) return cleared;
      const before = cleared;
      for (const record of batch) {
        if (this.options.database.history.delete(record.id, this.now(), this.options.deviceId())) cleared += 1;
      }
      if (cleared === before) return cleared;
    }
  }

  clearArchives(): number {
    let cleared = 0;
    for (const record of this.options.database.archives.list()) {
      if (this.options.database.archives.delete(record.id, this.now(), this.options.deviceId())) cleared += 1;
    }
    return cleared;
  }

  async resetLocal(): Promise<SyncStatus> {
    await this.options.sync.disconnect();
    this.options.database.resetLocalData();
    return this.options.sync.status();
  }
}
