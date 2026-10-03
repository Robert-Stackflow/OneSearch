package main

import (
	"fmt"
	"onesearch/internal/console"
	"os"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "用法: backup-extract 备份文件 全新输出目录；密码从 ONESEARCH_BACKUP_PASSWORD 环境变量读取")
		os.Exit(1)
	}
	password := os.Getenv("ONESEARCH_BACKUP_PASSWORD")
	if len(password) < 12 {
		fmt.Fprintln(os.Stderr, "请设置备份密码环境变量")
		os.Exit(1)
	}
	b, e := os.ReadFile(os.Args[1])
	if e == nil {
		e = console.ExtractBackup(b, password, os.Args[2])
	}
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	fmt.Println("已解密到新目录。平台恢复前须停止后台；搜索 dump 请导入全新的实例。")
}
