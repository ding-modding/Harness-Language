# Skill: PostgreSQLSafeMigration
주어진 데이터베이스 스키마 변경 요청을 바탕으로 무중단 배포가 가능한 DDL을 작성합니다.

## 제약 사항
1. 절대 DROP TABLE, TRUNCATE 등의 파괴적 쿼리를 생성하지 마십시오.
2. 테이블 풀 락(Lock)을 방지하기 위해 ADD COLUMN 시 DEFAULT 값 설정에 유의하십시오.
3. 롤백을 위한 Down 마이그레이션 쿼리를 반드시 작성하십시오.
