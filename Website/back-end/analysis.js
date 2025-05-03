let chartInstance; // To store the Chart.js instance for updates

// Function to load and parse the CSV file
async function loadCSV() {
    const response = await fetch('london_weather_collisions_2013_2023.csv');
    const text = await response.text();

    const rows = text.split('\n').map(row => row.split(','));
    const headers = rows[0]; // First row contains headers
    const data = rows.slice(1).map(row => {
        const entry = {};
        headers.forEach((header, index) => {
            entry[header] = row[index];
        });
        return entry;
    });
    return data;
}

// Function to filter data by date range
function filterDataByDate(data, startDate, endDate) {
    return data.filter(entry => {
        const collisionDate = new Date(entry.date); // Adjust the header name for the date column
        return collisionDate >= new Date(startDate) && collisionDate <= new Date(endDate);
    });
}

// Function to process collision data
function processCollisionData(filteredData) {
    const collisionCounts = filteredData.reduce((acc, entry) => {
        const severity = entry.severity; // Adjust the header name for the severity column
        acc[severity] = (acc[severity] || 0) + 1;
        return acc;
    }, {});

    const labels = Object.keys(collisionCounts).sort();
    const counts = labels.map(label => collisionCounts[label]);

    return { labels, counts };
}

// Function to create/update the chart
function updateChart(labels, counts) {
    const ctx = document.getElementById('lineChart').getContext('2d');

    if (counts.length === 0) {
        document.getElementById('chartError').style.display = 'block';
        if (chartInstance) chartInstance.destroy(); // Clear chart if no data
        return;
    } else {
        document.getElementById('chartError').style.display = 'none';
    }

    // If a chart instance exists, destroy it before creating a new one
    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Collision Counts by Severity',
                data: counts,
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Collision Severity',
                    },
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Number of Collisions',
                    },
                },
            },
        },
    });
}

// Event listeners for date pickers
document.addEventListener('DOMContentLoaded', async () => {
    const startPicker = document.getElementById('startPicker11');
    const endPicker = document.getElementById('endPicker22');
    const data = await loadCSV(); // Load CSV data

    const updateChartIfDatesValid = () => {
        const startDate = startPicker.value;
        const endDate = endPicker.value;

        if (startDate && endDate && new Date(startDate) <= new Date(endDate)) {
            const filteredData = filterDataByDate(data, startDate, endDate);
            const { labels, counts } = processCollisionData(filteredData);
            updateChart(labels, counts);
        } else {
            document.getElementById('chartError').textContent = 'Invalid date range selected.';
            document.getElementById('chartError').style.display = 'block';
        }
    };

    startPicker.addEventListener('change', updateChartIfDatesValid);
    endPicker.addEventListener('change', updateChartIfDatesValid);
});
