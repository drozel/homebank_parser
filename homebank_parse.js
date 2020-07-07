const fs = require('fs');
const chalk = require('chalk');
const XmlParser = require('fast-xml-parser');
const commandLineArgs = require('command-line-args')
const commandLineUsage = require('command-line-usage')

const HbGen = require('./hb_csvgen');
const CsvParser = require('./csv_parser');
const Categorizer = require('./categorizer');

const CategoriesListFilepath = './cache/categorieslist.json'; 

// command line config (+ help)
const optionDefinitions = [
	{ name: 'help',            alias: 'h', type: Boolean },
	{ name: 'input',           alias: 'i', type: String  },
	{ name: 'output',          alias: 'o', type: String  },
	{ name: 'schema',          alias: 's', type: String  },
	{ name: 'loadcategories',  alias: 'l', type: String  },
	{ name: 'zeroamount',      alias: 'z', type: Boolean },
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
			name: 'loadcategories',
			alias: 'l',
			typeLabel: '{underline file}',
			  description: 'Path to HomeBank file to parse existing categories. If once done, you will select from suggested categories instead of typing them every time.'
		},
		{
			name: 'zeroamount',
			alias: 'z',
			description: "Don't skip transactions with zero amount."
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

// load categories mode
if (options.loadcategories) {
	try {
		var count = loadCategories();
		exit(`${count} categories are load from HomeBank config and saved for further use`);
	} catch (e) {
		fail(e);
	}
}

// normal parse mode
//try {
	parseCsv().then(res => {
		 console.log(chalk.green(`${res} entries have been successfuly generated and written into ${options.output}!`));
	});
/*} catch (e) {
	fail(e);
}*/


async function parseCsv() {
	// we parse CSV here with given schema, try to categorize transactions and generate output CSV
	
	checkFileOption(options.input, 'input csv file (-i)');
	checkFileOption(options.schema, 'schema file (-s)');
	fs.writeFileSync(options.output, '', (err) => {
		fail(`cannot open output file for write (-o): ${option.output}`);
	});
	
	// try to open known transactions
	var categoriesList = null;
	if (fs.existsSync(CategoriesListFilepath)) {
		categoriesList = JSON.parse(fs.readFileSync(CategoriesListFilepath));
		if (!Array.isArray(categoriesList)) fail(`Strange format of categories list (must be array): ${categories.list}`);
	}
	
	// parse CSV using options file
	var schema = null;
	schema = JSON.parse(fs.readFileSync(options.schema));

	var parser = new CsvParser(options.input, schema);
	parser.parse();
	
	var data = parser.getData();
	
	if (!options.zeroamount) {
		data.entries = data.entries.filter(t => t.amount !== 0.0);
	}

	// categorize transactions
	var categorizer = new Categorizer(categoriesList);
 	await categorizer.categorize(data);
	
	// generate output CSV
	var gen = new HbGen();
	var out =  gen.generate(data);
	fs.writeFileSync(options.output, out, (err) => {
		throw `cannot open output file for write (-o): ${option.output}`;
	});

	return data.entries.length;
}

function loadCategories() {
	checkFileOption(options.loadcategories, 'HomeBank config');

	var xmlParserOpt = {
		ignoreAttributes : false,
		parseNodeValue : true,
		parseAttributeValue : true,
	};

	var data = fs.readFileSync(options.loadcategories).toString();
	if (!XmlParser.validate(data)) {
		fail(`couldn't read XML from HomeBank data: ${options.loadCategories}`);
	}
	var homebankData = XmlParser.parse(data, xmlParserOpt);

	var catsHash = [];
	var categoriesAsText = [];
	homebankData.homebank.cat.forEach(c => {
		const key  = c['@_key'];
		const name = c['@_name'];
		var fullCatName;
		if ('@_parent' in c) { // category with parent, build its name with the parent's one
			var parentKey = c['@_parent'];
			var parent = catsHash.find(p => p.key === parentKey);
			if (!parent) throw `couldn't find parent ${parentKey} for the category ${key}`

			fullCatName = parent.name + ':' + name;
		} else { // standalone category
			fullCatName = name;
		}

		// category found
		categoriesAsText.push(fullCatName);
		
		// add to cache to use it by children
		var cat = {
			key: key,
			name: fullCatName,
		};
		catsHash.push(cat);
	})

	fs.writeFileSync(CategoriesListFilepath, JSON.stringify(categoriesAsText));

	return categoriesAsText.length;
}

function fail(msg) {
	console.log(chalk.red(msg));
	process.exit(1);
}

function exit(msg) {
	console.log(chalk.green(msg));
	process.exit(0);
}
function checkFileOption(path, desc) {
	if (path === '')          fail(`Please give correct path to ${desc}`);
	if (!fs.existsSync(path)) fail(`Cannot read file ${desc} (given path: '${path}')`);
}