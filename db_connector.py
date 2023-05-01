import psycopg2, os

class Db:
    def __init__(self, logger):
        self.logger = logger
        self.valid = False

        db_host = os.environ.get('DB_HOST', 'localhost')
        db_name = os.environ.get('DB_NAME')
        db_user = os.environ.get('DB_USER')
        db_password = os.environ.get('DB_PASSWORD')
        
        self.logger.info('using db %s on %s to save data' % (db_name, db_host))
        try:
            self.conn = psycopg2.connect(
                host=db_host,
                database=db_name,
                user=db_user,
                password=db_password
            )
            self.cur = self.conn.cursor()
            self.table = 'entries'
        except psycopg2.Error as e:
            self.logger.warn('couldn\'t connect to DB: %s' % e.pgerror)
            return    


        create_table_query = '''
            CREATE TABLE IF NOT EXISTS %s (
                id SERIAL PRIMARY KEY,
                date_parsed TIMESTAMP NOT NULL,
                date TIMESTAMP NOT NULL,
                parser VARCHAR NOT NULL,
                account VARCHAR,
                type VARCHAR,
                payee VARCHAR,
                description VARCHAR,
                sum FLOAT NOT NULL,
                orig VARCHAR NOT NULL,
                hash VARCHAR(40) NOT NULL
            )
        ''' % (self.table);

        self.cur.execute(create_table_query)
        self.cur.execute('CREATE INDEX IF NOT EXISTS my_table_hash_idx ON %s (hash)' % self.table)

        self.valid = True

    def __del__(self):
        if hasattr(self, 'cur'):
            self.cur.close()
    
        if hasattr(self, 'conn'):
            self.conn.close()

    def write(self, data):
        if not self.valid:
            return
        
        skipped = 0
        processed = 0

        for entry in data:
            select_query = '''
                SELECT * FROM %s
                WHERE date = %%s AND hash = %%s
            ''' % (self.table)
            self.cur.execute(select_query, (entry['date'], entry['orig_hash']))

            if len(self.cur.fetchall()) > 0:
                self.logger.debug('entry already exist, skipping: %s' % entry['orig'])
                skipped += 1
                continue
            
            insert_query = '''
                INSERT INTO %s (date_parsed,
                                    date, parser, account, type, payee, description, sum, orig, hash)
                VALUES (CURRENT_TIMESTAMP, %%s, %%s, %%s, %%s, %%s, %%s, %%s, %%s, %%s)
            ''' % self.table

            self.cur.execute(insert_query, (entry['date'],
                                            entry['parser_name'],
                                            entry['account'],
                                            entry['type'],
                                            entry['payee'],
                                            entry['desc'],
                                            entry['sum'],
                                            entry['orig'],
                                            entry['orig_hash']))

            self.logger.debug('adding entry: %s' % entry['orig'])
            processed += 1

        self.conn.commit()

        self.logger.info('%d entries saved in the DB, %d skipped' % (processed, skipped))