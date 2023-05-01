import os, yaml, datetime, locale, re, hashlib

from db_connector import Db

config_filename = 'config.yml'

class Parser:
    def __init__(self, storage, logger):
        self.storage = storage
        self.logger = logger

    def parse(self, path):
        dir, file = os.path.split(path)

        if file == config_filename: # not parsed directly
            return

        config_file = os.path.join(dir, config_filename)

        if not os.path.isfile(config_file):
            self.logger.warning('field mapping unavailable for the folder %s, ignoring file %s' % (dir,file))
            return
            
        parser = _ParserImpl(config_file)
        self.logger.info('processing "%s" with parser "%s"' % (file, parser.config['name']))
        
        with open(path, 'r', errors='ignore') as file:
            for line in file:
                parser.parse_line(line)
            
        db = Db(self.logger)
        db.write(parser.data)

class _ParserImpl:
    def __init__(self, config_file):
        with open(config_file) as f:
            self.config = yaml.safe_load(f)
            self.line_counter = 0
            self.data = []

            locale.setlocale(locale.LC_ALL, self.config['locale'])

    def parse_line(self, line):
        if self.config['header'] and self.line_counter == 0:
            self.line_counter += 1
            return

        fields = line.split(self.config['separator'])
        
        # remove outer quotes
        fields = [re.sub(r'^([\'"])(.*)\1$', r'\2', item) for item in fields]

        rv = {}

        rv['parser_name'] = self.config['name']
        rv['date'] = datetime.datetime.strptime(fields[self.config['fields']['date']['number']], self.config['fields']['date']['format'])
        rv['account'] = fields[self.config['fields']['account']]
        rv['type'] = fields[self.config['fields']['type']]
        rv['payee'] = fields[self.config['fields']['payee']]
        rv['desc'] = fields[self.config['fields']['desc']]
        rv['sum'] = locale.atof(fields[self.config['fields']['sum']])
        rv['orig'] = line
        rv['orig_hash'] = hashlib.sha1(line.encode()).hexdigest()

        self.line_counter += 1
        self.data.append(rv)