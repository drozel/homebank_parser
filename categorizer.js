'use strict';


const fs = require('fs');
const chalk = require('chalk');
const moment = require('moment');
const readlineSync = require('readline-sync');
const { AutoComplete } = require('enquirer');

const { exit } = require('process');
const { type } = require('os');
const { timingSafeEqual } = require('crypto');

const DecisionsFilename = 'config/decisions.json';

async function asyncForEach(array, callback) {
	for (let index = 0; index < array.length; index++) {
	  await callback(array[index], index, array);
	}
}

class TransactionMatcher {
	constructFromRes(companyRe, descriptionRe) {
		this.companyRe = new RegExp(companyRe);
		this.descriptionRe = new RegExp(descriptionRe);
	}

	constructFromStruct(struct) {
		this.constructFromRes(struct.company, struct.description);
	}

	constructor(a, b) {
		if (typeof(a) === 'string' && typeof(b) === 'string') {
			this.constructFromRes(a, b);
		} else
		if (typeof(a) == 'object' && 'company' in a && 'description' in a) {
			this.constructFromStruct(a);
		} else {
			throw `Strange arguments in ctor of TransactionMatcher: ${JSON.stringify(a)}, ${JSON.stringify(b)}`;
		}
	}

	match(tran) {
		var m =
				tran.company.match(this.companyRe) &&
				tran.description.match(this.descriptionRe);
		return m;
	}
}

class Categorizer {
	constructor(categories_list, verbose = false) {
		this.categories = categories_list;
		this.loadDecisions();
		this.verbose = verbose;
	}
	
	logDebug(msg) {
		if (!this.verbose) return;
		console.log(msg);
	}

	loadDecisions() {
		if (fs.existsSync(DecisionsFilename)) {
			this.decisions = JSON.parse(fs.readFileSync(DecisionsFilename));
			if (!Array.isArray(this.decisions)) throw `couldn't parse categories from file: ${DecisionsFilename}, should be array`;
		} else {
			this.decisions = [];
		}
		console.log(`${this.decisions.length} known decisions were load from file`);
	}

	addCategory(cat) {
		this.decisions.push(cat);
		fs.writeFileSync(DecisionsFilename, JSON.stringify(this.decisions, null, '\t'));
	}

	applyCategory(tran, cat) {
		var rv = { ...tran };

		tran.category = cat.category;
		tran.description = cat.description;
		tran.memo = cat.memo;

		return rv;
	}

	async tryCategorize(tran) {
		var rv = {
			res: "",
			foundCategories: []
		};
		
		this.logDebug(`trying to categorize: ${this.printTransaction(tran)}`);

		// search matching categories for user file first, then in the cache
		this.decisions.forEach(cat => {
			var m = new TransactionMatcher(cat);
			if (m.match(tran)) {
				rv.foundCategories.push(cat);	
				this.logDebug(`matches to: ${cat}`);
			}
		});

		// only one cat => found, put description into the field. Else put it to conflicts or not found depending on result
		if (rv.foundCategories.length === 0) {
			this.logDebug(`no category!`);
			rv.res = "not_found";
		}
		else if (rv.foundCategories.length === 1) {
			this.applyCategory(tran, rv.foundCategories[0]);
			this.logDebug(`parsed as ${rv.foundCategories[0]}`);
			rv.res = "ok";
		}
		else {
			this.logDebug(`conflicts between [${rv.foundCategories.join(';')}]`);
			rv.res = "confilict";
		}

		return rv;
	}

	async categorize(data) {
		console.log(`Input data contains ${data.entries.length} entries`);

		// go trough all transactions and search for mathing category
		var trans = data.entries.length;
		await asyncForEach(data.entries, async(tran, idx) => {
			if (!tran.tags) tran.tags = [];
			
			// categorize
			var res = await this.tryCategorize(tran);
			if (res.res == "ok") return;

			console.log(chalk.green(`${idx+1}/${trans}`));

			if (res.res == "not_found") await this.processNotFound(tran);
			if (res.res == "conflict") {
				var cat = await this.processConflicts(tran, res.foundCategories);
			}

			if (cat === null) { // null categories are UNDONE transactions, mark them with the tag
				tran.category = '';
				tran.memo = e.tran;
				tran.tags.push('UNDONE');
			}
		});
	}

	async processConflicts(tran, foundCategories) {
		var matchingCategoriesFormatted = [];
		foundCategories.forEach(c => {
			matchingCategoriesFormatted.push(`${c.category} (${c.memo})`);
		});

		console.log(`\n${chalk.green(`CONFLICT:`)}\n${this.printTransaction(tran)}\nis matсhing to several categories. Please select the right one.`);
		var index = readlineSync.keyInSelect(matchingCategoriesFormatted, 'Select desired category.', {cancel: 'SKIP. (You can enter another value on furter step)'});
		if (index === -1) {
			console.log(chalk.yellow('Transaction skipped and will be marked with UNDONE'));
			return;
		}

		var choice = c.matchingCategories[index];
		console.log(chalk.green(`Transaction marked as '${choice.category} (${choice.memo})'`));
		this.applyCategory(tran, choice);
	}
	
	async processNotFound(tran) {
		readlineSync.setDefaultOptions({defaultInput: ''});

		const ImportAsUndone = 'IMPORT AS UNDONE'; // some transactions can't be imported in homeBank (e.g. Internal Transfers). We import them marked and change manually
		const NewCategory    = 'NEW CATEGORY';     // item for creating new category by the user
		
		const prompt = new AutoComplete({
			name: 'categories',
			message: 'Pick the category:',
			limit: 20,
			choices: [ImportAsUndone, NewCategory].concat(this.categories)
		});
		
		var catName = '';

		console.log("Manual categorizer\n");
		console.log(chalk.green(`${this.printTransaction(tran)}`));

		try {
			console.log('\n');
			catName = await prompt.run();
		} catch(e) {
		}
			
		var cat = {};
		var saveDecision = false;

		if (catName === ImportAsUndone) {
			cat.category = null;
		} else
		if (catName === NewCategory) {
			cat.category = readlineSync.question('Enter the category: ');
		} else {
			cat.category = catName;
		}

		if (readlineSync.keyInYN(chalk.yellow('Remember this decision?'))) {	
			cat.company     = readlineSync.question('Company mask (regexp): '),
			cat.description = readlineSync.question('Description mask (regexp): ')
			saveDecision = true;
		}

		cat.memo = readlineSync.question('Enter memo: ');

		if (saveDecision) this.addCategory(cat);

		this.applyCategory(tran, cat);
	}

	// helpers
	printTransaction(tran) {
		var colorizeAmount = function(val) {
			if (val > 0) return chalk.green(val.toString());
			if (val < 0) return chalk.red  (val.toString());

			return chalk.white(val.toString());
		}

		return `\
${chalk.yellow('Type: ')}        ${chalk.white(tran.type)}\n\		
${chalk.yellow('Company: ')}     ${chalk.white(tran.company)}\n\
${chalk.yellow('Description: ')} ${chalk.white(tran.description)}\n\
${chalk.yellow('Amount: ')}      ${colorizeAmount(tran.amount)}\n\
${chalk.yellow('Date:')}         ${chalk.white(moment(tran.date).format('DD-MM-YYYY'))}`;
	}
}

module.exports = Categorizer;