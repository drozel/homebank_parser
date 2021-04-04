'use strict';

const XmlParser = require('fast-xml-parser');
const fs = require('fs');
const chalk = require('chalk');

class HomebankConfigParser {

	constructor(filepath, logger) {
		this.log = logger;

		if (filepath == '')           throw('Please give correct path to HomeBank config');
		if (!fs.existsSync(filepath)) throw(`Cannot read HomeBank config from ${filepath}`);

		var xmlParserOpt = {
			ignoreAttributes : false,
			parseNodeValue : true,
			parseAttributeValue : true,
		};
	
		var data = fs.readFileSync(filepath).toString();
		if (!XmlParser.validate(data)) {
			throw(`couldn't parse XML from HomeBank data: ${filepath}`);
		}
		const homebankData = XmlParser.parse(data, xmlParserOpt);
	
		this.parseCategories(homebankData);
		this.parseAccounts(homebankData);
	}
	
	parseCategories(hbData) {
		this.log.debug("parsing HomeDabnk categories...");

		this.categories = [];
		var catsHash = [];

		hbData.homebank.cat.forEach(c => {
			const key  = c['@_key'];
			const name = c['@_name'];
			
			var fullCatName;
			if ('@_parent' in c) { // category with parent, build its name with the parent's one
				var parent = catsHash.find(p => p.key === c['@_parent']);
				if (!parent) throw `couldn't find parent ${parentKey} for the category ${key}`
	
				fullCatName = parent.name + ':' + name;
			} else { // standalone category
				fullCatName = name;
				
				// save to the hash (for children)
				catsHash.push({
					key: key,
					name: fullCatName,
				});
			}

			this.categories.push(fullCatName);
			this.log.debug(`category found: ${fullCatName}`);
		});

		this.log.info(`${chalk.green(`${this.categories.length}`)} categories have been successfully parsed`);
	}

	parseAccounts(hbData) {
		this.log.debug("parsing HomeBank accounts...");

		this.accounts = [];

		hbData.homebank.account.forEach(a => {
			const name = a['@_name'];

			this.log.debug("account found: " + name);
			this.accounts.push(name);
		});

		this.log.info(`${chalk.green(`${this.accounts.length}`)} accounts have been successfully parsed`);
	}
};

module.exports = HomebankConfigParser;
