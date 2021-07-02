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

// matcher for transactions (see tran in csv_parser.js) by company or desc
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
	constructor(categories_list, logger) {
		this.categories = categories_list;
		this.log = logger;

		this.loadDecisions();
	}
	
	loadDecisions() {
		if (fs.existsSync(DecisionsFilename)) {
			this.decisions = JSON.parse(fs.readFileSync(DecisionsFilename));
			if (!Array.isArray(this.decisions)) throw `couldn't parse categories from file: ${DecisionsFilename}, should be array`;
		} else {
			this.decisions = [];
		}
		this.log.info(chalk.green(this.decisions.length)+ " known decisions were load from file and will be used for new transactions");
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
		
		this.log.debug(`trying to categorize: ${tran.raw}`);

		// search matching categories for user file first, then in the cache
		this.decisions.forEach(cat => {
			var m = new TransactionMatcher(cat);
			if (m.match(tran)) {
				rv.foundCategories.push(cat);	
				this.log.debug(`matches to: ${cat}`);
			}
		});

		// only one cat => found, put description into the field. Else put it to conflicts or not found depending on result
		if (rv.foundCategories.length === 0) {
			this.log.debug(`no category!`);
			rv.res = "not_found";
		}
		else if (rv.foundCategories.length === 1) {
			this.applyCategory(tran, rv.foundCategories[0]);
			this.log.debug(`parsed as ${rv.foundCategories[0]}`);
			rv.res = "ok";
		}
		else {
			this.log.debug(`conflicts between [${rv.foundCategories.join(';')}]`);
			rv.res = "confilict";
		}

		return rv;
	}

	async categorize(data) {
		this.log.info(`Input data contains ${data.entries.length} entries`);

		// go trough all transactions and search for mathing category
		var trans = data.entries.length;
		await asyncForEach(data.entries, async(tran, idx) => {
			if (!tran.tags) tran.tags = [];
			
			// categorize
			var res = await this.tryCategorize(tran);
			if (res.res == "ok") return;

			this.log.info("\n" + chalk.green(`${idx+1}/${trans}`));
			this.log.info(`${this.printTransaction(tran, true)}`);

			if (res.res == "not_found") await this.processNotFound(tran);
			if (res.res == "conflict") {
				var cat = await this.processConflict(tran, res.foundCategories);
			}

			if (cat === null) { // null categories are UNDONE transactions, mark them with the tag
				tran.category = '';
				tran.memo = tran.raw;
				print(`undone: ${JSON.dump(tran)}`)
			}
		});
	}

	async processConflict(tran, foundCategories) {
		var matchingCategoriesFormatted = [];
		foundCategories.forEach(c => {
			matchingCategoriesFormatted.push(`${c.category} (${c.memo})`);
		});

		var index = readlineSync.keyInSelect(matchingCategoriesFormatted,
										'This transaction matches to multiple categories.\nSelect a correct one:',
										{cancel: 'SKIP. (You can enter another value on furter step)'});

		if (index === -1) {
			this.log.info(chalk.yellow('Transaction skipped and will be marked with UNDONE'));
			return;
		}

		var choice = c.matchingCategories[index];
		this.log.info(chalk.green(`Transaction marked as '${choice.category} (${choice.memo})'`));
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

		try {
			this.log.info('\n');
			catName = await prompt.run();
		} catch(e) {
			this.cancelProcess();
			await this.processNotFound(tran); // if not cancelled, just retry this func
			return;
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

		if (cat.category) cat.memo = readlineSync.question('Enter memo: ');

		if (saveDecision) this.addCategory(cat);

		this.applyCategory(tran, cat);
	}

	async cancelProcess() {
		readlineSync.setDefaultOptions({defaultInput: ''});
		const msg = "If you stop categorizing you will lost all transactions you have already processed!\n"
					"Do you want to cancel (y/n)?";
		
		if (readlineSync.keyInYN(chalk.red(msg))) exit(1);
	}

	// helpers
	printTransaction(tran, formatted = false) {
		var colorizeAmount = function(val) {
			if (val > 0) return chalk.green(val.toString());
			if (val < 0) return chalk.red  (val.toString());

			return chalk.white(val.toString());
		}

		if (formatted) { return `\
	${chalk.yellow('Type: ')}        ${chalk.white(tran.type)}\n\
	${chalk.yellow('Company: ')}     ${chalk.white(tran.company)}\n\
	${chalk.yellow('Description: ')} ${chalk.white(tran.description)}\n\
	${chalk.yellow('Amount: ')}      ${colorizeAmount(tran.amount)}\n\
	${chalk.yellow('Date:')}         ${chalk.white(moment(tran.date).format('DD-MM-YYYY'))}\n\
	${chalk.yellow('Raw data:')}     ${chalk.grey(tran.raw)}`;
		} else {
			return moment(tran.date).format('DD-MM-YYYY') + ": " + colorizeAmount(tran.amount) + "\" " + tran.company + ", " + tran.description + "\"";
		}
	}
}

module.exports = Categorizer;