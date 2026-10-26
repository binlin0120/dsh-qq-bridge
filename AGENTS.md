# QQ project operations

## Backup retention
After an authorized change has passed its checks, run scripts/backup.sh to refresh backups/qq-latest.tar.gz. Keep only this one verified current archive. Do not create independent pre-change backup directories or dated archive piles. The backup script builds and verifies a replacement before rotating the prior file; on failure retain the prior archive and report failure. Daily scheduled backup is disabled by user request. Never delete the sole verified archive before its replacement is verified.
