import os
import sys
from contextlib import closing

import psycopg2
from dotenv import load_dotenv


def main():
    # Load .env sitting next to this script
    load_dotenv()

    cfg = {
        "host": os.getenv("PGHOST", "localhost"),
        "port": int(os.getenv("PGPORT", "5432")),
        "dbname": os.getenv("PGDATABASE", ""),
        "user": os.getenv("PGUSER", ""),
        "password": os.getenv("PGPASSWORD", ""),
    }

    print(f"Connecting to {cfg['host']}:{cfg['port']}/{cfg['dbname']} as {cfg['user']} ...")

    try:
        with closing(psycopg2.connect(**cfg)) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version(), current_database(), current_user;")
                row = cur.fetchone()
                print("OK:", row)
    except Exception as e:
        print("Connection failed:", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
