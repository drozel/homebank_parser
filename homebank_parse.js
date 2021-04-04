const fs = require('fs');
const chalk = require('chalk');
const commandLineArgs = require('command-line-args')
const commandLineUsage = require('command-line-usage')

const HbGen = require('./hb_csvgen');
const CsvParser = require('./csv_parser');
const Categorizer = require('./categorizer');
const HBParser = require('./hb_data_parser');
const { relativeTimeThreshold } = require('moment');

const CategoriesListFilepath = './config/categories.json'; 

// command line config (+ help)
const optionDefinitions = [
	{ name: 'help',            alias: 'h', type: Boolean },
	{ name: 'input',           alias: 'i', type: String  },
	{ name: 'config',          alias: 'c', type: String  },
	{ name: 'output',          alias: 'o', type: String  },
	{ name: 'schema',          alias: 's', type: String  },
	{ name: 'zeroamount',      alias: 'z', type: Boolean },
	{ name: 'verbose',         alias: 'v', type: Boolean },
]

const usage = [
	{
	  header: 'homebank_parse',
	  content: 'CSV parser for HomeBank accounting software (http://homebank.free.fr/).\n \
				  \n \
				  Supports schemas for import of any CSV format and interactive categorizer with presets and cache \n \
				  Please read README or <GITURL> for further information.',
	},
	{
	  header: 'Options',
	  optionList: [
		{
		  name: 'input',
		  alias: 'i',
		  typeLabel: '{underline file}',
		  description: 'The input CSV with transactions.'
		},
		{
			name: 'config',
			alias: 'c',
			typeLabel: '{underline file}',
		  	description: 'Path to HomeBank config file (for categories and accounts). Usually has an .xhb extension.'
		},
		{
			name: 'output',
			alias: 'o',
			typeLabel: '{underline file}',
		  	description: 'Path of output CSV for HomeBank (will be overwritten if exists).'
		},
		{
			name: 'schema',
			alias: 's',
			typeLabel: '{underline file}',
		  	description: 'Path to schema file with the input CSV format configuration'
		},
		{
			name: 'zeroamount',
			alias: 'z',
			description: "Don't skip transactions with zero amount."
		},
		{
			name: 'verbose',
			alias: 'v',
			description: "Print debug information"
		},
		
		{
		  name: 'help',
		  description: 'Print this usage guide.'
		}
	  ]
	}
  ]

// load options from command line
var options;
try {
	options = commandLineArgs(optionDefinitions)
} catch(e) {
	console.log(chalk.red(e));
	return;
}

// help
if (options.help) {
	console.log(commandLineUsage(usage));
	return;
}

class Logger {
	constructor(verbose = false) {
		this.verbose = verbose;
		if (verbose) console.log(chalk.yellow("verbose mode activated, you will see a lot of logs"));
	}

	info(msg) {
		console.log(msg);
	}

	debug(msg) {
		if (!this.verbose) return;
		console.log(msg);
	}
};

/////////////////////////////
//        main
////////////////////////////
(async() => {
	var log = new Logger(options.verbose);
	
	var hbData = new HBParser(options.config, log);
	
	// check input and output data 
	checkFileOption(options.input, 'input csv file (-i)');
	checkFileOption(options.schema, 'schema file (-s)');
	fs.writeFileSync(options.output, '', (err) => {
		fail(`cannot open output file for write (-o): ${option.output}`);
	});
	
	// parse input csv
	var schema = null;
	schema = JSON.parse(fs.readFileSync(options.schema));

	var parser = new CsvParser(options.input, schema);
	parser.parse();
	
	var data = parser.getData();

	if (!options.zeroamount) {
		data.entries = data.entries.filter(t => t.amount !== 0.0);
	}

	// categorize transactions
	var categorizer = new Categorizer(hbData.categories, log);
	await categorizer.categorize(data);
	
	// generate output CSV
	var gen = new HbGen();
	var out =  gen.generate(data);
	fs.writeFileSync(options.output, out, (err) => {
		throw `cannot open output file for write (-o): ${option.output}`;
	});

	console.log(chalk.green(`${res} entries have been successfuly generated and written into ${options.output}!`));
})()

function fail(msg) {
	console.log(chalk.red(msg));
	process.exit(1);
}

function checkFileOption(path, desc) {
	if (path === '')          fail(`Please give correct path to ${desc}`);
	if (!fs.existsSync(path)) fail(`Cannot read file ${desc} (given path: '${path}')`);
}