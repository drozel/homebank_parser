#!/bin/python3

import sys, time, os

import logging

import homeparser

from watchdog import events
from watchdog.observers import Observer
from watchdog.events import LoggingEventHandler

data_path = '/usr/src/homeparser/indata'

class FileObserver(events.FileSystemEventHandler):
    def __init__(self, parser):
        self.parser = parser
    
    def on_modified(self, ev):
        path = ev.src_path
       
        if os.path.isfile(path):
            logging.info('file updated, parse it: %s' % ev.src_path)
            self._parse(ev.src_path)

    def on_created(self, ev):
        path = ev.src_path
       
        if os.path.isfile(path):
            logging.info('file created, parse it: %s' % ev.src_path)
            self._parse(ev.src_path)

    def _parse(self, path):
        try:
            self.parser.parse(path)
        except:
            logging.warning('unknown error, parsing failed')

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format='%(asctime)s - %(message)s',
                        datefmt='%Y-%m-%d %H:%M:%S')
  
    parser = homeparser.Parser(1, logging)
    event_handler = FileObserver(parser)
 
    observer = Observer()
    observer.schedule(event_handler, data_path, recursive=True)
 
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
