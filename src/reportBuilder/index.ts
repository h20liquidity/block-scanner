import { ChartJSNodeCanvas, ChartCallback  } from "chartjs-node-canvas";
import { ChartConfiguration } from "chart.js";
import {ethers} from "ethers";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path" ;
import { cleanSortCsv } from "./reportBuilderUtils";

/**
 * Generate a list of profitable trades from the input records in the input csv.
 *
 * @param {string} filePath - Path for input csv file.
 * @param {number} targetRatio - Target ratio to consider a trade profitable.
 *
 * @returns {Object} dataset.
 * @returns {string} dataset.fileName Name of the file processed.
 * @returns {Object[]} dataset.profitableTrades Array of profitable trades.
 * @returns {number} connection.blockCount Number of blocks traversed.
 * @returns {number} connection.avgRatio Average Ratios across blocks.
 *
 *
*/
export function getDataset(filePath: string, targetRatio:number){
    const file =  fs.readFileSync(filePath);

    const fileName = path.parse(filePath).name;
    const input = file.toString();

    const records = parse(input, {
        columns: false,
        skip_empty_lines: true
    }).map(e => {
        return{
            chainId : e[0],
            blockNumber : Number(e[1]) ,
            fromToken : e[2],
            fromTokenDecimals : e[3],
            toToken : e[4],
            toTokenDecimals : e[5],
            amountIn : e[6],
            amountOut : e[7],
            ratio : Number(e[8]),
            gasCostInToken : Number(e[9])
        };
    });

    const profitableTrades = [];
    let sumOfRatio = 0;
    let blockCount = 0;
    for (let i = 0 ; i < records.length ; i++){
        const record = records[i];
        const ratio = ethers.utils.parseEther(targetRatio.toString());
        const amountIn = ethers.utils.parseEther(record.amountIn.toString());
        const amountOutCalculated = amountIn.mul(ratio).div("1" + "0".repeat(36 - record.toTokenDecimals));
        const amountOutReceived = ethers.utils.parseUnits(record.amountOut,record.toTokenDecimals);
        const gasCostInToken = ethers.utils.parseUnits(record.gasCostInToken.toString(),record.toTokenDecimals);

        if(
            amountOutReceived.gte(amountOutCalculated.add(gasCostInToken)) &&
            record.ratio > targetRatio
        ){
            profitableTrades.push(record);
        }
        blockCount++;
        sumOfRatio += record.ratio;
    }
    return {
        fileName,
        profitableTrades,
        blockCount,
        avgRatio : sumOfRatio/blockCount
    };
}

/**
 * Generate a list of profitable trades from the input records in the input csv.
 *
 * @param {string} filePath - Path for input csv file.
 * @param {number} targetRatio - Target ratio to consider a trade profitable.
 *
*/
export function getBlockRatios(records){
    const blockNumbers = [];
    const ratios = [];
    for (let i = 0 ; i < records.length ; i++){
        blockNumbers.push(records[i].blockNumber.toString());
        ratios.push(records[i].ratio);
    }
    return {blockNumbers,ratios};
}

/**
 * Generate a graph according to input config and save it in image format.
 *
 * @param {string} fileName - Name of the file to be saved in.
 * @param {ChartConfiguration} configuration - Chart configuration.
 * @param {number} width - Chart width.
 * @param {number} height - Chart height.
 *
*/
export async function generateGraph(
    fileName : string,
    configuration : ChartConfiguration,
    width : number,
    height : number
) {
    const chartCallback: ChartCallback = (ChartJS) => {
        ChartJS.defaults.responsive = true;
        ChartJS.defaults.maintainAspectRatio = false;
    };
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, chartCallback });
    const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    if (!fs.existsSync("./graphs")) {
        fs.mkdirSync("./graphs", { recursive: true });
    }
    await fs.promises.writeFile(`./graphs/${fileName}.png`, buffer, "base64");
}

/**
 * Get report data for input records in a csv file.
 *
 * @param {string} filePath - Path of csv file.
 * @param {number} targetRatio - Target ratio for trade to be considered profitable.
 *
*/
export async function generateReportData(
    filePath: string,
    targetRatio : number
){
    cleanSortCsv(filePath);
    const {fileName, profitableTrades,blockCount,avgRatio} = getDataset(filePath, targetRatio);
    const {blockNumbers,ratios} = getBlockRatios(profitableTrades);
    const chartWidth = 1200;
    const chartHeight = 800;
    const configuration: ChartConfiguration = {
        type: "line",
        data: {
            labels:blockNumbers,
            datasets: [{
                label: `Line Chart For ${fileName}`,
                data: ratios,
                fill: false,
                borderWidth: 1,
                tension: 0.1,
                borderColor : "rgba(54, 162, 235, 1)"
            }]
        },
        options :{
            scales: {
                x: {
                    title : {
                        text: "BLOCK NUMBERS",
                        display: true,
                        font: {
                            size: 15,
                            weight: "bold"
                        }
                    }
                },
                y : {
                    title : {
                        text: "RATIOS",
                        display: true,
                        font: {
                            size: 15,
                            weight : "bold"
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    usePointStyle : true
                }
            },
            elements: {
                point:{
                    radius : 3,
                    backgroundColor : "rgba(54, 162, 235, 0.2)"
                }
            }
        },
        plugins: [{
            id: "background-colour",
            beforeDraw: (chart) => {
                const ctx = chart.ctx;
                ctx.save();
                ctx.fillStyle = "white";
                ctx.fillRect(0, 0, chartWidth, chartHeight);
                ctx.restore();
            }
        }]
    };

    await generateGraph(
        fileName,
        configuration,
        chartWidth,
        chartHeight
    );

    return {
        fileName,
        blockCount,
        avgRatio,
        clearThresholdCount:ratios.length
    };
}

/**
 * Get report data for Sub1 strategy.
 *
 * @param {string} buyFilePath - Path of csv file containing buy trade data.
 * @param {string} sellFilePath - Path of csv file containing sell trade data.
 * @param {number} buyRatio - Target buy ratio
 * @param {number} sellRatio - Target sell ratio
 *
*/
export async function generateSub1ReportData(
    buyFilePath: string,
    sellFilePath: string,
    buyRatio : number,
    sellRatio : number
) {
    cleanSortCsv(buyFilePath);
    cleanSortCsv(sellFilePath);

    const {fileName: buyFile, profitableTrades: buyRecords} = getDataset(buyFilePath, buyRatio);
    const {fileName: sellFile, profitableTrades: sellRecords} = getDataset(sellFilePath, sellRatio);

    let flag = 0;
    let currentBlock = 0;
    const sub1 = [];
    const loopLength = buyRecords.length > sellRecords.length ? buyRecords.length : sellRecords.length;

    for(let i = 0; i < loopLength ; i++){
        if(flag == 0){
            if(buyRecords[i] && buyRecords[i].blockNumber > currentBlock){
                flag = 1;
                currentBlock = buyRecords[i].blockNumber;
                sub1.push(buyRecords[i]);
                i=-1;
            }
        }else{
            if(sellRecords[i] && sellRecords[i].blockNumber > currentBlock){
                flag = 0;
                currentBlock = sellRecords[i].blockNumber;
                sub1.push(sellRecords[i]);
                i=-1;
            }
        }
    }

    const {blockNumbers,ratios} = getBlockRatios(sub1);

    const chartWidth = 1200;
    const chartHeight = 800;
    const configuration: ChartConfiguration = {
        type: "line",
        data: {
            labels:blockNumbers,
            datasets: [{
                label: `Line Chart For ${buyFile} and ${sellFile}`,
                data: ratios,
                fill: false,
                borderWidth: 1,
                tension: 0.1,
                borderColor : "rgba(54, 162, 235, 1)"
            }]
        },
        options :{
            scales: {
                x: {
                    type: "linear",
                    position: "bottom",
                    title : {
                        text: "BLOCK NUMBERS",
                        display: true,
                        font: {
                            size: 15,
                            weight: "bold"
                        }
                    }
                },
                y : {
                    title : {
                        text: "RATIOS",
                        display: true,
                        font: {
                            size: 15,
                            weight : "bold"
                        }
                    }
                }

            },

            elements: {
                point:{
                    radius: 9,
                    backgroundColor : function(context) {

                        if(context.dataIndex % 2 == 0){
                            return "rgba(192, 0, 0, 1)";
                        }else{
                            return "rgba(3, 150, 3, 0.8)";
                        }

                    }
                }
            }
        },
        plugins: [{
            id: "background-colour",
            beforeDraw: (chart) => {
                const ctx = chart.ctx;
                ctx.save();
                ctx.fillStyle = "white";
                ctx.fillRect(0, 0, chartWidth, chartHeight);
                ctx.restore();
            }
        }]
    };

    await generateGraph(
        `${buyFile}-${sellFile}`,
        configuration,
        chartWidth,
        chartHeight
    );

    const roundTrips = sub1.length / 2;
    const returnForPeriod = (buyRatio * sellRatio) ** roundTrips;

    return {
        roundTrips : roundTrips,
        returnForPeriod : returnForPeriod
    };

}


