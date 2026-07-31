declare module 'sql-fingerprint' {
  /**
   * 将 SQL 转换为指纹形式
   * @param sql SQL 语句
   * @param matchMD5Checksum 是否替换 MD5 字符串
   * @param matchEmbeddedNumbers 是否保留嵌入的数字（如表名中的数字）
   */
  export default function fingerprint(
    sql: string,
    matchMD5Checksum?: boolean,
    matchEmbeddedNumbers?: boolean
  ): string;
}
